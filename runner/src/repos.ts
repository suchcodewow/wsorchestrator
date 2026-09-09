import { loadRepos, log, recordResource, type Repo, type RunRow } from "./db.js";
import { importRepo } from "./harness.js";

/**
 * Copy the site's listed GitHub repositories into a workshop's Harness Code.
 *
 * These are the rows in Settings → GitHub Repos: repositories an administrator
 * named once — the sample application a lab builds, an infrastructure module the
 * pipelines reference — that every workshop should have on hand. Each row says
 * where it belongs: `"org"` means one copy in the event's organization, shared
 * by the room, and `"project"` means a copy of its own inside every attendee's
 * project, which is what a lab that has attendees committing to it needs.
 *
 * Best-effort, unlike the rest of provisioning. A repository can be wrong in
 * ways nothing here can fix — a typo'd address, a repository that has since gone
 * private, one renamed by its owner — and Harness answers those with a 400.
 * Failing the run on one of them would mean a workshop that is otherwise
 * finished, with a roster of accounts and projects already made, stopping
 * halfway through the roster over a repository nobody needs to start. So each
 * import stands alone: a failure is logged by name and address, and the count on
 * the run page shows how many did not come across.
 *
 * Idempotent like everything else in a provision — an import of a repository
 * that is already there is a duplicate, which `api` treats as success — so a
 * grown or retried workshop re-confirms what it has, and a repository added in
 * settings reaches a workshop the next time it is provisioned.
 *
 * Nothing here has a teardown. An imported repository is a copy living inside
 * the org (or a project inside it), and goes when `deleteOrg` does — verified
 * against a live org and project that each held one.
 */

/** Import the org-scoped repositories once, into the event's organization. */
export async function importOrgRepos(
  run: RunRow,
  orgId: string,
): Promise<void> {
  const repos = (await loadRepos()).filter((r) => r.scope === "org");
  if (repos.length === 0) return;

  await log(
    run.id,
    "system",
    `Importing ${repos.length} repositor${repos.length === 1 ? "y" : "ies"} ` +
      `into org ${orgId}`,
  );

  let imported = 0;
  for (const repo of repos) {
    if (await tryImport(run, repo, orgId, undefined, `org ${orgId}`)) {
      imported += 1;
    }
  }

  await record(run, "org", "in the workshop's org", imported, repos.length);
}

/**
 * Prepare the per-attendee imports, returning what to call once each project
 * exists.
 *
 * Shaped as a factory because the list is site-wide and the projects are not:
 * loading it once and handing back a closure keeps a query per attendee out of
 * the roster loop, and lets the run page carry a single counted row across the
 * whole roster rather than one per attendee — the same pile-up the projects
 * themselves are counted to avoid.
 *
 * `attendees` is only there to make that count meaningful up front: the total is
 * every import the roster will ask for, so the row reads 0/40 before the first
 * project is made instead of climbing towards an unknown end.
 */
export async function projectRepoImporter(
  run: RunRow,
  orgId: string,
  attendees: number,
): Promise<(projectId: string) => Promise<void>> {
  const repos = (await loadRepos()).filter((r) => r.scope === "project");
  if (repos.length === 0 || attendees === 0) return async () => {};

  const total = repos.length * attendees;
  await log(
    run.id,
    "system",
    `Importing ${repos.length} repositor${repos.length === 1 ? "y" : "ies"} ` +
      `into each of the ${attendees} attendee project(s)`,
  );

  let imported = 0;
  const detail = "in every attendee's project";
  await record(run, "project", detail, imported, total);

  return async (projectId: string) => {
    for (const repo of repos) {
      if (await tryImport(run, repo, orgId, projectId, `project ${projectId}`)) {
        imported += 1;
      }
    }
    await record(run, "project", detail, imported, total);
  };
}

/**
 * One import, with its failure written down instead of thrown.
 *
 * The address is logged alongside the message because the message comes from
 * GitHub by way of Harness — `Couldn't find owner/name at github: Not Found` —
 * and what an organizer does about that is go look at the row in settings.
 */
async function tryImport(
  run: RunRow,
  repo: Repo,
  orgId: string,
  projectId: string | undefined,
  where: string,
): Promise<boolean> {
  try {
    const duplicate = await importRepo(
      orgId,
      projectId,
      repo.identifier,
      repo.providerRepo,
    );
    await log(
      run.id,
      "stdout",
      `${repo.providerRepo} -> ${repo.identifier} in ${where}` +
        (duplicate ? " (already there)" : ""),
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(
      run.id,
      "stderr",
      `${repo.identifier} not imported into ${where} — ${message}; check ` +
        `${repo.url} in Settings → GitHub Repos`,
    );
    return false;
  }
}

const record = (
  run: RunRow,
  key: "org" | "project",
  detail: string,
  done: number,
  total: number,
) =>
  recordResource(run.id, {
    kind: "harness_repos",
    key,
    label: "Harness code repositories",
    detail: done >= total ? detail : `${total - done} could not be imported`,
    done,
    total,
  });

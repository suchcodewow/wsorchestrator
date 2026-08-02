import path from "node:path";
import {
  gcpCfg,
  TF_ROOT,
  challengeProjectMap,
  makeProjectId,
} from "./config.js";
import { writeChallengeTfvars, writeTfvars } from "./workspace.js";
import { tfApply, tfInit, tfOutput } from "./terraform.js";
import { allocateEmails, createAccount, createOrgUnit } from "./directory.js";
import { displayName } from "./usernames.js";
import {
  createAttendeeRole,
  createOrg,
  createProject,
  grantAccountAdmin,
  grantOrgAttendee,
  grantProjectAdmin,
  orgIdentifier,
  orgUrl,
  projectIdentifier,
} from "./harness.js";
import {
  accountsFor,
  addAccount,
  getRun,
  log,
  runCreatorEmail,
  setApplying,
  setFailed,
  setLiveError,
  setOrgUnitPath,
  setProvisioning,
  setReady,
  type RunRow,
} from "./db.js";

/** Root config that creates the workshop's single shared GCP project. */
const GCP_TF_SOURCE = "workshops/gcp-base";

/** Root config that creates one GCP project per challenge competitor. */
const GCP_CHALLENGE_TF_SOURCE = "challenges/gcp-per-user";

/** Grant-only config: attendees get access to the shared long-lived project. */
const GCP_SANDBOX_TF_SOURCE = "workshops/gcp-sandbox";

/** Provision one workshop end to end: Workspace OU, accounts, then clouds. */
export async function runWorkshop(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);

  try {
    await setProvisioning(runId);

    const orgUnitPath = await provisionAccounts(run);
    const outputs: Record<string, unknown> = {
      org_unit_path: orgUnitPath,
      user_count: run.user_count,
    };

    // Harness is provisioned for every workshop, not gated on a cloud, and
    // after the accounts exist because each attendee is invited by address.
    Object.assign(outputs, await provisionHarness(run));

    if (run.clouds.length === 0) {
      // No cloud selected — hand attendees the shared long-lived testing
      // project instead of building (and later destroying) a throwaway one.
      Object.assign(outputs, await provisionSandbox(run));
    } else {
      for (const cloud of run.clouds) {
        if (cloud === "gcp") {
          Object.assign(
            outputs,
            run.mode === "challenge"
              ? await provisionGcpPerUser(run)
              : await provisionGcp(run),
          );
        } else {
          await log(
            runId,
            "system",
            `${cloud.toUpperCase()} was requested but is not wired up yet — skipping.`,
          );
        }
      }
    }

    // Keep the original expiry when re-provisioning a workshop that grew —
    // editing its config must not silently extend how long it lives.
    const expiresAt =
      run.expires_at ?? new Date(Date.now() + run.ttl_seconds * 1000);
    await setReady(runId, outputs, expiresAt);
    await log(runId, "system", `Ready. Auto-destroys at ${expiresAt.toISOString()}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(runId, "stderr", message);
    if (run.expires_at) {
      // This workshop was already live — a grow or a retry (a first provision
      // has no expiry until it goes ready). A failure here must not tear down
      // the accounts and clouds it already has, so leave it ready with its
      // original expiry and just surface what went wrong. The change did not
      // apply; what was there stays.
      await setLiveError(runId, message);
    } else {
      // First provision: record the failure but do not expire it. Nothing here
      // destroys resources on a failure — the run stays failed on the calendar
      // until someone deletes it in the UI, which is what cleans up any partial
      // resources it left behind.
      await setFailed(runId, message);
    }
    throw err;
  }
}

/** Create the workshop's org unit and its attendee accounts. */
async function provisionAccounts(run: RunRow): Promise<string> {
  await log(run.id, "system", `Creating organizational unit "${run.name}"`);
  const orgUnitPath = await createOrgUnit(run.name);
  await setOrgUnitPath(run.id, orgUnitPath);
  await log(run.id, "system", `Org unit ready at ${orgUnitPath}`);

  // Accounts already handed out must keep their credentials, so only the
  // missing ones are created. This is what makes growing a workshop safe.
  const existing = new Set((await accountsFor(run.id)).map((a) => a.email));
  const todo = run.user_count - existing.size;

  if (todo <= 0) {
    await log(run.id, "system", `${existing.size} attendee account(s) already exist`);
    return orgUnitPath;
  }
  await log(
    run.id,
    "system",
    existing.size > 0
      ? `Adding ${todo} attendee account(s) to the existing ${existing.size}`
      : `Creating ${todo} attendee account(s)`,
  );

  // Names are random, so they are reserved up front against the directory
  // rather than derived from the index. `existing` is passed in so a workshop
  // that grew cannot be handed a name it already owns.
  const emails = await allocateEmails(todo, existing);

  for (const email of emails) {
    const account = await createAccount({ email, orgUnitPath });
    await addAccount(run.id, account.email, account.tempPassword);
    await log(run.id, "stdout", `created ${account.email}`);
  }

  return orgUnitPath;
}

/**
 * Create the workshop's Harness organization and one project per attendee.
 *
 * Each attendee administers their own project and gets view/use access across
 * the org, so they can see everyone else's work without being able to change
 * it. Every call is idempotent, so a grown or retried workshop only adds what
 * is missing.
 */
async function provisionHarness(run: RunRow): Promise<Record<string, unknown>> {
  const orgId = orgIdentifier(run.name, run.id);

  await log(run.id, "system", `Creating Harness organization ${orgId}`);
  const existed = await createOrg(orgId, run.name);
  if (existed) {
    await log(run.id, "stdout", `organization ${orgId} already existed — reusing`);
  }

  // The org-scope binding every attendee gets references this role, so it has
  // to exist before anyone is bound to it.
  await createAttendeeRole(orgId);

  // Grant the run's creator account admin — the instructor role the reference
  // gives an event's owner. A creator without a recorded email is skipped
  // rather than failing the run.
  const creator = await runCreatorEmail(run.id);
  if (creator) {
    await grantAccountAdmin(creator);
    await log(run.id, "stdout", `${creator} -> account admin (instructor)`);
  } else {
    await log(run.id, "system", "no creator email on file — skipping account admin");
  }

  const accounts = await accountsFor(run.id);
  await log(
    run.id,
    "system",
    `Creating ${accounts.length} Harness project(s), one per attendee`,
  );

  for (const { email } of accounts) {
    const projectId = projectIdentifier(email);
    const { givenName, familyName } = displayName(email.split("@")[0] ?? email);

    await createProject(orgId, projectId, `${givenName} ${familyName}`);
    await grantProjectAdmin(orgId, projectId, email);
    await grantOrgAttendee(orgId, email);

    await log(run.id, "stdout", `${email} -> admin of project ${projectId}`);
  }

  return { harness_org: orgId, harness_org_url: orgUrl(orgId) };
}

/** Terraform the workshop's GCP project. */
async function provisionGcp(run: RunRow): Promise<Record<string, unknown>> {
  const cfg = gcpCfg();
  const workDir = path.join(TF_ROOT, GCP_TF_SOURCE);
  const projectId = run.gcp_project_id ?? makeProjectId(run.slug, run.id);

  await setApplying(run.id, projectId);
  await log(run.id, "system", `Provisioning GCP project ${projectId}`);

  // Read the accounts back rather than tracking which were just created, so a
  // workshop that grew re-grants the whole roster and Terraform converges.
  const attendees = (await accountsFor(run.id)).map((a) => a.email);
  writeTfvars(workDir, projectId, run.id, attendees);

  await log(run.id, "system", "terraform init");
  await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
    log(run.id, l.stream, l.text),
  );

  await log(
    run.id,
    "system",
    `terraform apply — creating project, billing, APIs, and granting ` +
      `editor to ${attendees.length} attendee(s)`,
  );
  await tfApply(workDir, (l) => log(run.id, l.stream, l.text));

  return tfOutput(workDir);
}

/**
 * Grant the run's attendees editor on the shared long-lived project. Used when
 * a run has no cloud selected — a fast path for testing that skips creating and
 * later destroying a per-run project. The Terraform here only manages the
 * attendees' IAM bindings; it never touches the project, so teardown just
 * revokes the grants (see `destroySandbox`).
 */
async function provisionSandbox(run: RunRow): Promise<Record<string, unknown>> {
  const cfg = gcpCfg();
  if (!cfg.sandboxProjectId) {
    throw new Error(
      "no cloud was selected, which grants attendees the shared testing " +
        "project, but GCP_SANDBOX_PROJECT_ID is not configured",
    );
  }
  const workDir = path.join(TF_ROOT, GCP_SANDBOX_TF_SOURCE);

  // No project id is stored on the run: the shared project is not this run's to
  // own, and keeping it out of `gcp_project_id` ensures no teardown path could
  // ever mistake it for a per-run project to delete.
  await setApplying(run.id, null);
  await log(
    run.id,
    "system",
    `No cloud selected — granting attendees access to the shared testing project ${cfg.sandboxProjectId}`,
  );

  // Read the accounts back rather than tracking which were just created, so a
  // workshop that grew re-grants the whole roster and Terraform converges.
  const attendees = (await accountsFor(run.id)).map((a) => a.email);
  writeTfvars(workDir, cfg.sandboxProjectId, run.id, attendees);

  await log(run.id, "system", "terraform init");
  await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
    log(run.id, l.stream, l.text),
  );

  await log(
    run.id,
    "system",
    `terraform apply — granting editor to ${attendees.length} attendee(s) on ${cfg.sandboxProjectId}`,
  );
  await tfApply(workDir, (l) => log(run.id, l.stream, l.text));

  return tfOutput(workDir);
}

/**
 * Terraform a challenge's GCP environment: one project per competitor, each
 * owned (administered) by the competitor it belongs to.
 *
 * `gcp_project_id` on the run stays null here — there is no single project to
 * put in it. The full address -> project id mapping lands in the run's
 * outputs, and the ids are recomputed rather than stored because
 * `makeChallengeProjectId` is deterministic in the address.
 */
async function provisionGcpPerUser(
  run: RunRow,
): Promise<Record<string, unknown>> {
  const cfg = gcpCfg();
  const workDir = path.join(TF_ROOT, GCP_CHALLENGE_TF_SOURCE);

  await setApplying(run.id, null);

  // Read the accounts back rather than tracking which were just created, so a
  // challenge that grew re-declares the whole roster and Terraform converges.
  const projects = challengeProjectMap(
    run.slug,
    run.id,
    (await accountsFor(run.id)).map((a) => a.email),
  );
  const count = Object.keys(projects).length;

  await log(
    run.id,
    "system",
    `Provisioning ${count} GCP project(s), one per competitor`,
  );

  writeChallengeTfvars(workDir, run.id, projects);

  await log(run.id, "system", "terraform init");
  await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
    log(run.id, l.stream, l.text),
  );

  await log(
    run.id,
    "system",
    `terraform apply — creating ${count} project(s), billing, and APIs, ` +
      `granting each competitor owner on their own`,
  );
  await tfApply(workDir, (l) => log(run.id, l.stream, l.text));

  return tfOutput(workDir);
}

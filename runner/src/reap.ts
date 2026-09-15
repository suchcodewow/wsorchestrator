import { existsSync } from "node:fs";
import path from "node:path";
import {
  awsAccountEmail,
  awsCfg,
  cloudStatePrefix,
  gcpCfg,
  stateBucket,
  TF_ROOT,
  challengeProjectMap,
  challengeResourceGroupMap,
  makeAwsAccountName,
  makeChallengeAwsAccountName,
  makeClusterName,
  makeProjectId,
  makeResourceGroupName,
  makeHarnessIdentity,
  regionFromLocation,
  SCENARIO_CONCURRENCY,
} from "./config.js";
import {
  writeAwsChallengeTfvars,
  writeAwsClusterTfvars,
  writeAwsCompetitorScenarioTfvars,
  writeAwsTfvars,
  writeAzureChallengeTfvars,
  writeAzureClusterTfvars,
  writeAzureScenarioTfvars,
  writeAzureTfvars,
  writeChallengeClusterTfvars,
  writeChallengeTfvars,
  writeGcpCompetitorScenarioTfvars,
  writeScenarioTfvars,
  writeTfvars,
} from "./workspace.js";
import {
  appliedScenarios,
  clusterStatePrefix,
  competitorSlug,
  hasScenarioRoot,
  scenarioById,
  scenarioStatePrefix,
  scenarioTfSource,
  scenarioWorkName,
} from "./scenarios.js";
import { mapConcurrent, summarize } from "./retry.js";
import {
  tfDestroy,
  tfInit,
  warmProviderCache,
  withWorkDir,
} from "./terraform.js";
import { deleteAccount, deleteOrgUnit } from "./directory.js";
import { teardownOrder } from "./components.js";
import {
  deleteAccountUser,
  deleteConnector,
  deleteOrg,
  deleteProject,
  deleteSecret,
  listOrgProjects,
  orgIdentifier,
  projectIdentifier,
  revokeOrgDelegateToken,
} from "./harness.js";
import {
  accountsFor,
  accountsWithPasswordsFor,
  deleteAccounts,
  deleteResources,
  claimDestroy,
  loadTemplateSources,
  reapableRuns,
  withRunLock,
  log,
  setDestroyed,
  setDestroyFailed,
  setDestroyRetry,
  type Cloud,
  type Component,
  type RunRow,
} from "./db.js";
import {
  decideDestroyFailure,
  describeDestroyFailure,
} from "./destroy-policy.js";

/** Root config that creates the workshop's single shared GCP project. */
const GCP_TF_SOURCE = "workshops/gcp-base";

/** Root config that creates one GCP project per challenge competitor. */
const GCP_CHALLENGE_TF_SOURCE = "challenges/gcp-per-user";

/** Root config that creates one GKE cluster per challenge competitor. */
const GCP_CHALLENGE_GKE_TF_SOURCE = "challenges/gcp-per-user-gke";

/** Grant-only config: revoking here removes attendee access, not the project. */
const GCP_SANDBOX_TF_SOURCE = "workshops/gcp-sandbox";

/** Root config that creates the workshop's shared Azure resource group. */
const AZURE_TF_SOURCE = "workshops/azure-base";

/** Root config that creates one Azure resource group per challenge competitor. */
const AZURE_CHALLENGE_TF_SOURCE = "challenges/azure-per-user";

/** Root config that creates one AKS cluster per challenge competitor. */
const AZURE_CHALLENGE_AKS_TF_SOURCE = "challenges/azure-per-user-aks";

/** Root config that creates the workshop's single AWS member account. */
const AWS_TF_SOURCE = "workshops/aws-base";

/** Single-account root, destroyed once per AWS challenge competitor. */
const AWS_CHALLENGE_TF_SOURCE = "challenges/aws-per-user";

/** Single-cluster root, destroyed once per AWS challenge competitor. */
const AWS_CHALLENGE_EKS_TF_SOURCE = "challenges/aws-per-user-eks";

/**
 * Destroy every run that is due: past its end time, or explicitly deleted in
 * the UI (see `reapableRuns`). Runs sequentially within this container.
 *
 * Each run is taken under `withRunLock`, so several of these executions can be
 * in flight at once — which they routinely are, since a teardown outlasts the
 * scheduler's tick — without two of them tearing down the same run. Any run
 * another execution is already working is skipped, and the ticks spread across
 * the remaining ones instead of piling onto the first.
 *
 * A teardown gets one attempt. Whether it fails or is killed mid-flight, the run
 * ends in `destroy_failed` with the reason on the row and waits for a person. The
 * single exception is a failure whose message is on a short list of conditions
 * known to clear themselves, which is handed back here for up to
 * `MAX_DESTROY_ATTEMPTS` ticks. See `destroy-policy.ts` for both halves: the
 * retry this replaced cost 9,482 identical attempts on one run, and the flag that
 * replaced *it* stopped three teardowns that would have finished by themselves.
 */
export async function reap(): Promise<void> {
  const runs = await reapableRuns();
  if (runs.length === 0) {
    console.log("reaper: nothing to destroy");
    return;
  }
  console.log(`reaper: destroying ${runs.length} run(s)`);

  for (const run of runs) {
    const ran = await withRunLock(run.id, () => destroyRun(run));
    if (!ran) {
      console.log(`reaper: ${run.id} already being destroyed elsewhere, skipping`);
    }
  }
}

async function destroyRun(run: RunRow): Promise<void> {
  // Claimed before any work starts, and released on every way out below. We hold
  // this run's advisory lock, so finding the claim already taken means the
  // attempt that took it is gone — killed before it could finish or report. That
  // is flagged, not retried: an attempt that dies the same way every time is the
  // one shape a retry budget cannot see, because nothing ever increments it.
  const claim = await claimDestroy(run.id);
  if (claim.outcome === "abandoned") {
    const explanation = describeDestroyFailure("died", "");
    await log(run.id, "stderr", explanation);
    await setDestroyFailed(run.id, explanation);
    console.error(`reaper: ${run.id} teardown died mid-attempt, flagged`);
    return;
  }

  try {
    // Clouds first — the accounts may hold access to them.
    if (run.harness_only) {
      // A sandbox run never ran Terraform, so there is no state to destroy and
      // no cloud to reach into. Its Harness org still goes, below.
    } else if (run.clouds.length === 0) {
      // No-cloud run: only attendee grants on the shared project to revoke.
      await destroySandbox(run);
    } else {
      for (const cloud of run.clouds) {
        if (cloud === "gcp") {
          if (run.mode === "challenge") await destroyGcpPerUser(run);
          else await destroyGcp(run);
        } else if (cloud === "azure") {
          if (run.mode === "challenge") await destroyAzurePerUser(run);
          else await destroyAzure(run);
        } else if (cloud === "aws") {
          if (run.mode === "challenge") await destroyAwsPerUser(run);
          else await destroyAws(run);
        }
        // An unrecognized cloud never got provisioned, so there is nothing to
        // tear down for it.
      }
    }

    await destroyHarness(run);

    const accounts = await accountsFor(run.id);

    // The attendees' Harness account membership, which outlives the org they
    // worked in — see `deleteAccountUser`. Runs before the roster is dropped
    // below, for the same reason the Google deletes do: it is the only record of
    // who has to be removed.
    await removeHarnessUsers(run, accounts.map((a) => a.email));

    if (accounts.length > 0) {
      await log(run.id, "system", `Deleting ${accounts.length} attendee account(s)`);
      for (const { email } of accounts) {
        await deleteAccount(email);
        await log(run.id, "stdout", `deleted ${email}`);
      }
    }

    if (run.org_unit_path) {
      // `deleteOrgUnit` sweeps whoever is actually in the OU, so this also
      // clears any user the roster above never knew about — e.g. an orphan a
      // gateway 502 left behind when a create failed after Google made the
      // account. It must run before dropping the roster below.
      await log(run.id, "system", `Deleting org unit ${run.org_unit_path}`);
      await deleteOrgUnit(run.org_unit_path);
    }

    // Only now that the accounts and their OU are gone is it safe to forget the
    // roster. If any step above threw, the run is flagged with the roster intact
    // — so a person's retry still has the record of what is left to delete.
    if (accounts.length > 0) await deleteAccounts(run.id);

    // The list of what this run built described what was standing; nothing is
    // now, so it goes with the resources rather than outliving them on a page
    // that would then be advertising a cluster that is gone.
    await deleteResources(run.id);

    // Logged first: `setDestroyed` may remove the run outright — it does when
    // somebody deleted it — and a log line for a run that is gone has nothing
    // to reference.
    await log(run.id, "system", "Destroyed.");
    await setDestroyed(run.id);
  } catch (err) {
    // One attempt, then a person — except for the named conditions that clear
    // themselves, which get another tick up to a cap. Every retry is a Cloud Run
    // execution and a full init/destroy against live cloud APIs, so the exception
    // is a short list of strings with runs behind them, not a category.
    // `destroy-policy.ts` has the reasoning and the numbers.
    const message = err instanceof Error ? err.message : String(err);
    const decision = decideDestroyFailure("failed", message, claim.attempt);

    // Logged before the status change for the same reason `setDestroyed` demands
    // it: this is the line that explains why the run stopped — or why it has not
    // — and it has to be on the page next to the state it explains.
    if (decision.action === "retry") {
      await log(run.id, "stderr", decision.note);
      await setDestroyRetry(run.id, decision.note);
      console.error(
        `reaper: destroy of ${run.id} hit a self-clearing failure on attempt ` +
          `${claim.attempt}, retrying next tick:`,
        message,
      );
      return;
    }

    await log(run.id, "stderr", decision.reason);
    await setDestroyFailed(run.id, decision.reason);
    console.error(`reaper: failed to destroy ${run.id}:`, message);
  }
}

/**
 * Delete the workshop's Harness projects, then its organization. Projects go
 * first because Harness refuses to delete an organization that still has any.
 *
 * The projects are read from the org itself, not recomputed from the attendee
 * roster — a project created for an attendee whose DB row was later lost would
 * otherwise linger and block the org delete, the same orphan-wedge that stalled
 * OU deletion. If the org can't be listed, fall back to the ids a provision
 * would have made: one per attendee, deterministic in the address, plus one per
 * project-scoped template source (see `copyOrgContent`). Either of those left
 * behind wedges the org delete just as surely.
 */
async function destroyHarness(run: RunRow): Promise<void> {
  const orgId = orgIdentifier(run.name, run.id);

  await log(run.id, "system", `Deleting Harness organization ${orgId}`);

  let projectIds: string[];
  try {
    projectIds = await listOrgProjects(orgId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(
      run.id,
      "stdout",
      `could not list org projects (${message}); falling back to the roster`,
    );
    projectIds = [
      ...(await accountsFor(run.id)).map((a) => projectIdentifier(a.email)),
      ...(await loadTemplateSources())
        .map((s) => s.projectIdentifier)
        .filter((id): id is string => id !== null),
    ];
  }
  for (const projectId of projectIds) {
    await deleteProject(orgId, projectId);
    await log(run.id, "stdout", `deleted project ${projectId}`);
  }

  // Everything the component catalog put in the org, dependents first.
  //
  // The credentials themselves die with the identities `terraform destroy` has
  // already removed, so this is about not leaving the org's contents behind it
  // — and Harness refuses to delete a secret a connector still references, so
  // the order is not merely tidy. `teardownOrder` is the apply order reversed,
  // derived from the same dependency graph, which is what keeps this correct as
  // the catalog grows: it used to be a hand-written list of three cloud
  // triples, and a contributed template above a contributed connector would
  // have been left standing by it.
  //
  // Best-effort, and attempted for every component whatever this run applied: a
  // delete of something absent answers 404, which the client already treats as
  // done.
  let catalog: Component[] = [];
  try {
    catalog = await teardownOrder(run.component_set_id ?? undefined);
  } catch (err) {
    // A catalog that will not resolve must not strand the org. Nothing below
    // runs, the org delete still does, and Harness removes the contents with it.
    const message = err instanceof Error ? err.message : String(err);
    await log(run.id, "stdout", `component teardown skipped: ${message}`);
  }
  for (const component of catalog) {
    // Templates are left to the org delete below rather than removed one at a
    // time. A template is identified by version as well as identifier, so
    // deleting one properly means enumerating its versions and removing each —
    // several requests per template to tidy an organization that is about to
    // stop existing. Ordering still matters and still holds: templates come
    // first in the reversed order, so a connector is never deleted while a
    // template above it is still being considered.
    if (component.kind === "template") continue;

    const remove =
      component.kind === "connector"
        ? () => deleteConnector(orgId, component.identifier)
        : () => deleteSecret(orgId, component.identifier);
    try {
      await remove();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await log(
        run.id,
        "stdout",
        `${component.kind} ${component.identifier} delete skipped: ${message}`,
      );
    }
  }

  // Revoke the org's delegate token before deleting the org — a live token
  // can keep the org from being removed. Best-effort: nothing was necessarily
  // created (delegates are opt-in and best-effort), so a failure here must not
  // block teardown.
  try {
    await revokeOrgDelegateToken(orgId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(run.id, "stdout", `delegate token revoke skipped: ${message}`);
  }

  await deleteOrg(orgId);
}

/**
 * Remove the run's attendees from the Harness account, so a torn-down workshop
 * leaves nobody behind in the account's user list.
 *
 * Driven by the run's roster rather than by who Harness reports in the org. An
 * org's user list also shows whoever holds an inherited account-level binding —
 * the instructor among them — and these addresses are the accounts this run
 * created, which makes them the only ones it has any business deleting. A
 * sandbox run has no roster at all: its projects belong to the contributor's own
 * address, and that is a real person's Harness login, not a workshop account.
 *
 * Best-effort per attendee. `rawRequest` already retries Harness's own 5xx and
 * rate limiting, so what reaches here is a refusal a retry would repeat — and a
 * run must not sit in `destroying` forever, with its clouds already gone, over
 * one user Harness will not remove.
 */
async function removeHarnessUsers(
  run: RunRow,
  emails: string[],
): Promise<void> {
  if (emails.length === 0) return;

  await log(
    run.id,
    "system",
    `Removing ${emails.length} attendee(s) from the Harness account`,
  );
  for (const email of emails) {
    try {
      const removed = await deleteAccountUser(email);
      await log(
        run.id,
        "stdout",
        removed
          ? `removed Harness user ${email}`
          : `no Harness user for ${email} — nothing to remove`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await log(
        run.id,
        "stdout",
        `Harness user ${email} removal skipped: ${message}`,
      );
    }
  }
}

async function destroyGcp(run: RunRow): Promise<void> {
  const cfg = gcpCfg();
  const workDir = path.join(TF_ROOT, GCP_TF_SOURCE);
  const projectId = run.gcp_project_id ?? makeProjectId(run.slug, run.id);

  await log(run.id, "system", `Destroying GCP project ${projectId}`);
  // Accounts are still on record here — destroyGcp runs before they are
  // deleted — so the tfvars match the state Terraform is tearing down. The
  // cluster name is deterministic in (slug, runId), so it matches what
  // provisioning wrote without anything being stored.
  const attendees = (await accountsFor(run.id)).map((a) => a.email);
  writeTfvars(workDir, projectId, run.id, attendees, {
    clusterName: makeClusterName(run.slug, run.id),
    // Where it was built, which for a run older than the region default's move
    // is not where a new one would go. Destroy works off state either way, but
    // the config it evaluates on the way should describe the same place.
    region: regionFromLocation(run.outputs?.gke_cluster_location),
    // Deterministic in (slug, runId), so this names the account provisioning
    // created — for the same reason the cluster name is recomputed here.
    serviceAccountId: makeHarnessIdentity(run.slug, run.id),
  });
  await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
    log(run.id, l.stream, l.text),
  );
  await tfDestroy(workDir, (l) => log(run.id, l.stream, l.text));
}

/**
 * Revoke a no-cloud run's attendee grants on the shared long-lived project.
 * `terraform destroy` here removes only the `google_project_iam_member`
 * bindings this run added — the project is not managed by this config, so it
 * (and every other run's grants) is left running. Nothing here can delete it.
 */
async function destroySandbox(run: RunRow): Promise<void> {
  const cfg = gcpCfg();
  if (!cfg.sandboxProjectId) {
    // Never configured, so nothing was granted — nothing to revoke.
    return;
  }
  const workDir = path.join(TF_ROOT, GCP_SANDBOX_TF_SOURCE);

  // Accounts are still on record here — this runs before they are deleted — so
  // the roster matches the grants Terraform is revoking.
  const attendees = (await accountsFor(run.id)).map((a) => a.email);

  await log(
    run.id,
    "system",
    `Revoking ${attendees.length} attendee grant(s) and destroying the GKE cluster on the shared testing project ${cfg.sandboxProjectId} (the project itself stays running)`,
  );
  writeTfvars(workDir, cfg.sandboxProjectId, run.id, attendees, {
    clusterName: makeClusterName(run.slug, run.id),
    region: regionFromLocation(run.outputs?.gke_cluster_location),
    // The shared project outlives the run, so this is the one teardown that
    // has to name the account explicitly for it to be removed with everything
    // else — and deleting it is what revokes the key Harness was given.
    serviceAccountId: makeHarnessIdentity(run.slug, run.id),
  });
  await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
    log(run.id, l.stream, l.text),
  );
  await tfDestroy(workDir, (l) => log(run.id, l.stream, l.text));
}

/**
 * Tear down a challenge's per-competitor projects, and whatever the run's
 * scenarios layered on top of them first.
 *
 * The order is the reverse of provisioning and it is not cosmetic: deleting a
 * GCP project takes everything inside it, so a scenario or cluster layer
 * destroyed afterwards would be reconciling state against resources that no
 * longer exist. Destroying them first leaves each layer's state honestly empty.
 */
async function destroyGcpPerUser(run: RunRow): Promise<void> {
  const cfg = gcpCfg();
  const workDir = path.join(TF_ROOT, GCP_CHALLENGE_TF_SOURCE);

  // Accounts are still on record here — this runs before they are deleted —
  // so the map matches the state Terraform is tearing down.
  const projects = challengeProjectMap(
    run.slug,
    run.id,
    (await accountsFor(run.id)).map((a) => a.email),
  );

  await destroyChallengeScenarios(run, projects);
  await destroyChallengeCluster(run, projects);

  await log(
    run.id,
    "system",
    `Destroying ${Object.keys(projects).length} competitor GCP project(s)`,
  );
  writeChallengeTfvars(workDir, run.id, projects);
  await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
    log(run.id, l.stream, l.text),
  );
  await tfDestroy(workDir, (l) => log(run.id, l.stream, l.text));
}

/**
 * Destroy the scenario layers a run actually built.
 *
 * Driven by `outputs.scenarios_applied` — what is standing — rather than
 * `run.scenarios`, which is what the organizer last asked for. The two differ
 * when a scenario was unchecked and the reprovision that would have removed it
 * failed, and in that case it is the standing one that has to go.
 *
 * Best-effort per scenario: one that will not destroy is logged and the rest
 * still run, because the project destroy below removes its resources anyway.
 * Letting one wedged layer block that would strand a whole challenge's projects.
 */
async function destroyChallengeScenarios(
  run: RunRow,
  projects: Record<string, string>,
): Promise<void> {
  const region = regionFromLocation(challengeClusterLocation(run)) ?? gcpCfg().region;

  await destroyScenarioLayers(run, "gcp", {
    emails: Object.keys(projects),
    writeRoster: (dir, id) =>
      writeScenarioTfvars(dir, run.id, id, projects, region, {}, {}),
    writeOne: (dir, id, email) =>
      writeGcpCompetitorScenarioTfvars(dir, run.id, id, region, {
        email,
        projectId: projects[email] ?? "",
        clusterName: "",
        location: "",
        networkName: "",
        nodeTag: "",
      }),
  });
}

/**
 * Destroy whichever scenario layers a run has standing, in whichever shape each
 * declares.
 *
 * Driven by `outputs.scenarios_applied` — what is standing — unioned with what
 * the organizer last selected. The two differ when a scenario was unchecked and
 * the reprovision that would have removed it failed, and in that case it is the
 * standing one that has to go.
 *
 * **Best-effort throughout, deliberately.** Destroying the environment below
 * removes everything a scenario built anyway: deleting a GCP project, closing
 * an AWS account or removing an Azure resource group takes the contents with it.
 * What this pass buys is state that honestly says the resources are gone, and a
 * competitor's environment returned to working order if the run is somehow kept.
 * Neither is worth letting one wedged layer strand an entire challenge's
 * teardown, so a failure is logged and the next one runs.
 *
 * Per-competitor layers are destroyed concurrently, like they were applied.
 */
async function destroyScenarioLayers(
  run: RunRow,
  cloud: Cloud,
  ctx: {
    emails: string[];
    writeRoster: (workDir: string, scenarioId: string) => void;
    writeOne: (workDir: string, scenarioId: string, email: string) => void;
  },
): Promise<void> {
  const standing = [
    ...new Set([...appliedScenarios(run.outputs), ...run.scenarios]),
  ];
  if (standing.length === 0) return;

  const bucket = stateBucket();
  const line = (l: { stream: "stdout" | "stderr"; text: string }) =>
    log(run.id, l.stream, l.text);

  for (const id of standing) {
    const scenario = scenarioById(id);

    // A scenario the current build no longer ships, or one belonging to another
    // cloud. Neither can be destroyed on its own; the environment teardown
    // below is what actually removes what it built.
    if (!scenario) {
      await log(
        run.id,
        "stderr",
        `Scenario ${id} is not in this build, so its layer could not be ` +
          `destroyed on its own — destroying the environment removes what it built.`,
      );
      continue;
    }
    if (scenario.cloud !== cloud) continue;

    // A cluster scenario has no layer of its own; the cluster teardown below is
    // what removes what it asked for.
    if (!hasScenarioRoot(scenario)) continue;

    try {
      await log(run.id, "system", `Destroying scenario ${id}`);

      if (!scenario.perCompetitor) {
        const workDir = path.join(TF_ROOT, scenarioTfSource(id));
        ctx.writeRoster(workDir, id);
        await tfInit(
          workDir,
          bucket,
          scenarioStatePrefix(run.state_prefix, id),
          line,
        );
        await tfDestroy(workDir, line);
        continue;
      }

      await warmProviderCache(
        scenarioTfSource(id),
        bucket,
        scenarioStatePrefix(run.state_prefix, id),
      );
      await mapConcurrent(ctx.emails, SCENARIO_CONCURRENCY, async (email) => {
        const slug = competitorSlug(email);
        await withWorkDir(
          scenarioTfSource(id),
          scenarioWorkName(run.id, id, slug),
          async (workDir) => {
            ctx.writeOne(workDir, id, email);
            await tfInit(
              workDir,
              bucket,
              scenarioStatePrefix(run.state_prefix, id, slug),
              line,
            );
            await tfDestroy(workDir, line);
          },
        );
      });
    } catch (err) {
      await log(
        run.id,
        "stderr",
        `Scenario ${id} would not destroy (${summarize(err)}). Continuing — ` +
          `destroying the environment removes what it built.`,
      );
    }
  }
}

/** Destroy the per-competitor clusters, if any scenario built them. */
async function destroyChallengeCluster(
  run: RunRow,
  projects: Record<string, string>,
): Promise<void> {
  const location = challengeClusterLocation(run);
  if (!location) return;

  const workDir = path.join(TF_ROOT, GCP_CHALLENGE_GKE_TF_SOURCE);
  const region = regionFromLocation(location) ?? gcpCfg().region;
  const zone = location.slice(location.lastIndexOf("-") + 1);

  await log(
    run.id,
    "system",
    `Destroying ${Object.keys(projects).length} competitor GKE cluster(s)`,
  );
  writeChallengeClusterTfvars(workDir, run.id, projects, region, zone);
  await tfInit(
    workDir,
    stateBucket(),
    clusterStatePrefix(run.state_prefix),
    (l) => log(run.id, l.stream, l.text),
  );
  await tfDestroy(workDir, (l) => log(run.id, l.stream, l.text));
}

/**
 * Where this challenge's clusters were built, or undefined if it never had any.
 *
 * Doubles as the "was there a cluster layer at all" test, which is why teardown
 * reads it rather than re-deriving from the scenario manifests: a scenario
 * removed from the repo since the run was built would answer that question
 * wrong, and the recorded output cannot.
 */
function challengeClusterLocation(run: RunRow): string | undefined {
  const many = run.outputs?.gke_cluster_locations;
  if (!many || typeof many !== "object" || Array.isArray(many)) return undefined;
  const first = Object.values(many as Record<string, unknown>)[0];
  return typeof first === "string" ? first : undefined;
}

/** Address -> temp-password map, matching the Azure tfvars provisioning wrote. */
async function attendeePasswords(
  runId: string,
): Promise<Record<string, string>> {
  const accounts = await accountsWithPasswordsFor(runId);
  return Object.fromEntries(accounts.map((a) => [a.email, a.tempPassword]));
}

/**
 * Destroy a workshop's Azure environment — the resource group (which takes the
 * AKS cluster and everything in it with it) and the attendees' Entra users. The
 * tfvars are rebuilt deterministically, so `terraform destroy` tears down
 * exactly what `provisionAzure` created.
 */
async function destroyAzure(run: RunRow): Promise<void> {
  const workDir = path.join(TF_ROOT, AZURE_TF_SOURCE);
  const resourceGroup = makeResourceGroupName(run.slug, run.id);

  await log(run.id, "system", `Destroying Azure resource group ${resourceGroup}`);
  // Accounts are still on record here — this runs before they are deleted.
  const attendees = await attendeePasswords(run.id);
  writeAzureTfvars(
    workDir,
    run.id,
    resourceGroup,
    makeClusterName(run.slug, run.id),
    attendees,
    // Deterministic in (slug, runId), so this names the app registration
    // provisioning created — for the same reason the cluster name is
    // recomputed here. Deleting it is what revokes the client secret Harness
    // was given.
    makeHarnessIdentity(run.slug, run.id),
  );
  await tfInit(
    workDir,
    stateBucket(),
    cloudStatePrefix(run.state_prefix, "azure"),
    (l) => log(run.id, l.stream, l.text),
  );
  await tfDestroy(workDir, (l) => log(run.id, l.stream, l.text));
}

/** Tear down a challenge's per-competitor Azure resource groups and users. */
async function destroyAzurePerUser(run: RunRow): Promise<void> {
  const workDir = path.join(TF_ROOT, AZURE_CHALLENGE_TF_SOURCE);

  const attendees = await attendeePasswords(run.id);
  const groups = challengeResourceGroupMap(
    run.slug,
    run.id,
    Object.keys(attendees),
  );

  // Scenarios, then the clusters they sat on, then the resource groups — the
  // reverse of provisioning, for the same reason as GCP: removing a resource
  // group takes everything in it, and a layer destroyed afterwards would be
  // reconciling against resources that no longer exist.
  await destroyScenarioLayers(run, "azure", {
    emails: Object.keys(groups),
    writeRoster: (dir, id) =>
      writeAzureScenarioTfvars(dir, run.id, id, groups, {}, {}),
    writeOne: (dir, id, email) =>
      writeAzureScenarioTfvars(
        dir,
        run.id,
        id,
        { [email]: groups[email] },
        {},
        {},
      ),
  });
  await destroyAzureChallengeCluster(run, groups);

  await log(
    run.id,
    "system",
    `Destroying ${Object.keys(groups).length} competitor Azure resource group(s)`,
  );
  writeAzureChallengeTfvars(workDir, run.id, groups, attendees);
  await tfInit(
    workDir,
    stateBucket(),
    cloudStatePrefix(run.state_prefix, "azure"),
    (l) => log(run.id, l.stream, l.text),
  );
  await tfDestroy(workDir, (l) => log(run.id, l.stream, l.text));
}

/** Destroy a challenge's per-competitor AKS clusters, if a scenario built them. */
async function destroyAzureChallengeCluster(
  run: RunRow,
  groups: Record<string, string>,
): Promise<void> {
  // The recorded output is the "were there any" test, for the same reason GCP's
  // is: a scenario dropped from the repo since the run was built would answer
  // that question wrong, and what was recorded cannot.
  if (!run.outputs?.aks_clusters) return;

  const workDir = path.join(TF_ROOT, AZURE_CHALLENGE_AKS_TF_SOURCE);
  await log(
    run.id,
    "system",
    `Destroying ${Object.keys(groups).length} competitor AKS cluster(s)`,
  );
  writeAzureClusterTfvars(workDir, run.id, groups);
  await tfInit(
    workDir,
    stateBucket(),
    clusterStatePrefix(cloudStatePrefix(run.state_prefix, "azure")),
    (l) => log(run.id, l.stream, l.text),
  );
  await tfDestroy(workDir, (l) => log(run.id, l.stream, l.text));
}

/**
 * Destroy a workshop's AWS environment. `terraform destroy` deletes the EKS
 * cluster and IAM users, then closes the member account
 * (close_on_deletion = true). The account then sits suspended ~90 days before
 * AWS frees it — the reaper's part is done once destroy returns.
 */
async function destroyAws(run: RunRow): Promise<void> {
  const cfg = awsCfg();
  const workDir = path.join(TF_ROOT, AWS_TF_SOURCE);
  const accountName = makeAwsAccountName(run.slug, run.id);
  const accountEmail = awsAccountEmail(accountName, cfg.accountEmailDomain);

  await log(
    run.id,
    "system",
    `Destroying AWS account ${accountName} (closes the account)`,
  );
  const attendees = (await accountsFor(run.id)).map((a) => a.email);
  writeAwsTfvars(
    workDir,
    run.id,
    accountName,
    accountEmail,
    makeClusterName(run.slug, run.id),
    attendees,
    // The IAM user provisioning created, named the same way. Closing the
    // account would take it regardless; naming it keeps the config being
    // destroyed a description of what was built.
    makeHarnessIdentity(run.slug, run.id),
  );
  await tfInit(
    workDir,
    stateBucket(),
    cloudStatePrefix(run.state_prefix, "aws"),
    (l) => log(run.id, l.stream, l.text),
  );
  await tfDestroy(workDir, (l) => log(run.id, l.stream, l.text));
}

/**
 * Tear down a challenge's per-competitor AWS accounts — one destroy per
 * competitor, mirroring how `provisionAwsPerUser` applied them, each against
 * its own account-name-keyed state prefix. Closing each account starts its
 * ~90-day suspension; the reaper's part is done when destroy returns.
 */
async function destroyAwsPerUser(run: RunRow): Promise<void> {
  const cfg = awsCfg();
  const workDir = path.join(TF_ROOT, AWS_CHALLENGE_TF_SOURCE);
  const emails = (await accountsFor(run.id)).map((a) => a.email);

  // The account ids the provisioner recorded. Scenario and cluster layers need
  // them to assume back in, and once the account is closed they are useless —
  // which is why both run before the loop below rather than after it.
  const accountIds = mapOutput(run.outputs?.aws_accounts);

  await destroyScenarioLayers(run, "aws", {
    emails: emails.filter((e) => accountIds[e]),
    writeRoster: (dir, id) =>
      writeAwsCompetitorScenarioTfvars(dir, run.id, id, "", "", ""),
    writeOne: (dir, id, email) =>
      writeAwsCompetitorScenarioTfvars(
        dir,
        run.id,
        id,
        email,
        accountIds[email] ?? "",
        makeChallengeAwsAccountName(run.slug, run.id, email),
      ),
  });
  await destroyAwsChallengeCluster(run, accountIds);

  await log(
    run.id,
    "system",
    `Destroying ${emails.length} competitor AWS account(s)`,
  );

  for (const email of emails) {
    const accountName = makeChallengeAwsAccountName(run.slug, run.id, email);
    const accountEmail = awsAccountEmail(accountName, cfg.accountEmailDomain);
    const prefix = `${cloudStatePrefix(run.state_prefix, "aws")}/${accountName}`;

    await log(run.id, "system", `Closing AWS account ${accountName} (${email})`);
    writeAwsChallengeTfvars(workDir, run.id, accountName, accountEmail, email);
    await tfInit(workDir, stateBucket(), prefix, (l) =>
      log(run.id, l.stream, l.text),
    );
    await tfDestroy(workDir, (l) => log(run.id, l.stream, l.text));
  }
}

/**
 * Destroy a challenge's per-competitor EKS clusters, if a scenario built them.
 *
 * Concurrently, like they were built. Closing the account below would take the
 * cluster with it either way, but an account with a live EKS cluster in it is
 * slower to close and leaves a bill running in the meantime, so this is worth
 * doing properly rather than leaving to the account closure.
 */
async function destroyAwsChallengeCluster(
  run: RunRow,
  accountIds: Record<string, string>,
): Promise<void> {
  if (!run.outputs?.eks_clusters) return;

  const emails = Object.keys(accountIds);
  const bucket = stateBucket();
  const base = cloudStatePrefix(run.state_prefix, "aws");
  const line = (l: { stream: "stdout" | "stderr"; text: string }) =>
    log(run.id, l.stream, l.text);

  await log(
    run.id,
    "system",
    `Destroying ${emails.length} competitor EKS cluster(s)`,
  );

  await warmProviderCache(AWS_CHALLENGE_EKS_TF_SOURCE, bucket, `${base}/cluster`);
  await mapConcurrent(emails, SCENARIO_CONCURRENCY, async (email) => {
    const slug = competitorSlug(email);
    await withWorkDir(
      AWS_CHALLENGE_EKS_TF_SOURCE,
      scenarioWorkName(run.id, "eks", slug),
      async (workDir) => {
        writeAwsClusterTfvars(
          workDir,
          run.id,
          email,
          accountIds[email],
          makeChallengeAwsAccountName(run.slug, run.id, email),
        );
        await tfInit(workDir, bucket, `${base}/cluster/${slug}`, line);
        await tfDestroy(workDir, line);
      },
    );
  });
}

/** A run output that should be an address -> string map, or an empty one. */
function mapOutput(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).flatMap(([k, val]) =>
      typeof val === "string" ? [[k, val] as const] : [],
    ),
  );
}

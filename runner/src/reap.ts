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
} from "./config.js";
import {
  writeAwsChallengeTfvars,
  writeAwsTfvars,
  writeAzureChallengeTfvars,
  writeAzureTfvars,
  writeChallengeTfvars,
  writeTfvars,
} from "./workspace.js";
import { tfDestroy, tfInit } from "./terraform.js";
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
  reapableRuns,
  withRunLock,
  log,
  setDestroyed,
  setDestroyFailed,
  type Component,
  type RunRow,
} from "./db.js";
import { describeDestroyFailure } from "./destroy-policy.js";

/** Root config that creates the workshop's single shared GCP project. */
const GCP_TF_SOURCE = "workshops/gcp-base";

/** Root config that creates one GCP project per challenge competitor. */
const GCP_CHALLENGE_TF_SOURCE = "challenges/gcp-per-user";

/** Grant-only config: revoking here removes attendee access, not the project. */
const GCP_SANDBOX_TF_SOURCE = "workshops/gcp-sandbox";

/** Root config that creates the workshop's shared Azure resource group. */
const AZURE_TF_SOURCE = "workshops/azure-base";

/** Root config that creates one Azure resource group per challenge competitor. */
const AZURE_CHALLENGE_TF_SOURCE = "challenges/azure-per-user";

/** Root config that creates the workshop's single AWS member account. */
const AWS_TF_SOURCE = "workshops/aws-base";

/** Single-account root, destroyed once per AWS challenge competitor. */
const AWS_CHALLENGE_TF_SOURCE = "challenges/aws-per-user";

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
 * A teardown gets exactly one attempt. Whether it fails or is killed mid-flight,
 * the run ends in `destroy_failed` with the reason on the row and waits for a
 * person — it is never handed back here on the next tick. See `destroy-policy.ts`
 * for why: the retry this replaced cost 9,482 identical attempts on one run.
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
  if ((await claimDestroy(run.id)) === "abandoned") {
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
    // One attempt, then a person. No budget and no backoff: every retry is a
    // Cloud Run execution and a full init/destroy against live cloud APIs, and
    // the failures this has actually had were doomed identically every time.
    // `destroy-policy.ts` has the reasoning and the numbers.
    const message = err instanceof Error ? err.message : String(err);
    const explanation = describeDestroyFailure("failed", message);

    // Logged before the status change for the same reason `setDestroyed` demands
    // it: this is the line that explains why the run stopped, and it has to be
    // on the page next to the state it explains.
    await log(run.id, "stderr", explanation);
    await setDestroyFailed(run.id, explanation);
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
 * OU deletion. If the org can't be listed, fall back to the roster-derived ids
 * (which are deterministic in the address) rather than skipping the delete.
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
    projectIds = (await accountsFor(run.id)).map((a) =>
      projectIdentifier(a.email),
    );
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

/** Tear down a challenge's per-competitor projects. */
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

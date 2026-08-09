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
import {
  deleteOrg,
  deleteProject,
  listOrgProjects,
  orgIdentifier,
  projectIdentifier,
  revokeOrgDelegateToken,
} from "./harness.js";
import {
  accountsFor,
  accountsWithPasswordsFor,
  deleteAccounts,
  reapableRuns,
  log,
  setDestroyed,
  setDestroying,
  type RunRow,
} from "./db.js";

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
 */
export async function reap(): Promise<void> {
  const runs = await reapableRuns();
  if (runs.length === 0) {
    console.log("reaper: nothing to destroy");
    return;
  }
  console.log(`reaper: destroying ${runs.length} run(s)`);

  for (const run of runs) {
    await destroyRun(run);
  }
}

async function destroyRun(run: RunRow): Promise<void> {
  try {
    await setDestroying(run.id);

    // Clouds first — the accounts may hold access to them.
    if (run.clouds.length === 0) {
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
    // roster. If any step above threw, the run is retried next tick with the
    // roster intact — so teardown never strands itself without a record of what
    // it still has to delete.
    if (accounts.length > 0) await deleteAccounts(run.id);

    // Logged first: `setDestroyed` may remove the run outright — it does when
    // somebody deleted it — and a log line for a run that is gone has nothing
    // to reference.
    await log(run.id, "system", "Destroyed.");
    await setDestroyed(run.id);
  } catch (err) {
    // Leave the run for the next reaper tick to retry.
    const message = err instanceof Error ? err.message : String(err);
    await log(run.id, "stderr", `destroy failed, will retry: ${message}`);
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

import path from "node:path";
import {
  cloudStatePrefix,
  gcpCfg,
  stateBucket,
  TF_ROOT,
  challengeProjectMap,
  challengeResourceGroupMap,
  makeClusterName,
  makeProjectId,
  makeResourceGroupName,
} from "./config.js";
import {
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
  orgIdentifier,
  projectIdentifier,
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
      await deleteAccounts(run.id);
    }

    if (run.org_unit_path) {
      await log(run.id, "system", `Deleting org unit ${run.org_unit_path}`);
      await deleteOrgUnit(run.org_unit_path);
    }

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
 * Both the identifiers are derived the same way they were on the way in, so
 * nothing extra needs to be stored to find them again.
 */
async function destroyHarness(run: RunRow): Promise<void> {
  const orgId = orgIdentifier(run.name, run.id);
  const accounts = await accountsFor(run.id);

  await log(run.id, "system", `Deleting Harness organization ${orgId}`);
  for (const { email } of accounts) {
    const projectId = projectIdentifier(email);
    await deleteProject(orgId, projectId);
    await log(run.id, "stdout", `deleted project ${projectId}`);
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
  writeTfvars(workDir, projectId, run.id, attendees, makeClusterName(run.slug, run.id));
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
  writeTfvars(
    workDir,
    cfg.sandboxProjectId,
    run.id,
    attendees,
    makeClusterName(run.slug, run.id),
  );
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

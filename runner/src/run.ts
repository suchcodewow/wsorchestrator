import path from "node:path";
import { gcpCfg, TF_ROOT, makeProjectId } from "./config.js";
import { writeTfvars } from "./workspace.js";
import { tfApply, tfInit, tfOutput } from "./terraform.js";
import { accountEmail, createAccount, createOrgUnit } from "./directory.js";
import {
  accountsFor,
  addAccount,
  getRun,
  log,
  setApplying,
  setFailed,
  setOrgUnitPath,
  setProvisioning,
  setReady,
  type RunRow,
} from "./db.js";

/** Root config that creates the workshop's GCP project. */
const GCP_TF_SOURCE = "workshops/gcp-base";

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

    for (const cloud of run.clouds) {
      if (cloud === "gcp") {
        Object.assign(outputs, await provisionGcp(run));
      } else {
        await log(
          runId,
          "system",
          `${cloud.toUpperCase()} was requested but is not wired up yet — skipping.`,
        );
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
    // Expire immediately so the reaper cleans up any partial resources.
    await setFailed(runId, message, new Date());
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

  for (let n = 1; n <= run.user_count; n++) {
    const email = accountEmail(run.slug, n);
    if (existing.has(email)) continue;

    const account = await createAccount({
      email,
      givenName: run.name.slice(0, 60),
      familyName: `User ${n}`,
      orgUnitPath,
    });
    await addAccount(run.id, account.email, account.tempPassword);
    await log(run.id, "stdout", `created ${account.email}`);
  }

  return orgUnitPath;
}

/** Terraform the workshop's GCP project. */
async function provisionGcp(run: RunRow): Promise<Record<string, unknown>> {
  const cfg = gcpCfg();
  const workDir = path.join(TF_ROOT, GCP_TF_SOURCE);
  const projectId = run.gcp_project_id ?? makeProjectId(run.slug, run.id);

  await setApplying(run.id, projectId);
  await log(run.id, "system", `Provisioning GCP project ${projectId}`);

  writeTfvars(workDir, projectId, run.id);

  await log(run.id, "system", "terraform init");
  await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
    log(run.id, l.stream, l.text),
  );

  await log(run.id, "system", "terraform apply — creating project, billing, APIs");
  await tfApply(workDir, (l) => log(run.id, l.stream, l.text));

  return tfOutput(workDir);
}

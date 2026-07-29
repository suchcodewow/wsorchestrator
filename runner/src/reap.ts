import path from "node:path";
import { gcpCfg, TF_ROOT, makeProjectId } from "./config.js";
import { writeTfvars } from "./workspace.js";
import { tfDestroy, tfInit } from "./terraform.js";
import { deleteAccount, deleteOrgUnit } from "./directory.js";
import {
  accountsFor,
  deleteAccounts,
  expiredRuns,
  log,
  setDestroyed,
  setDestroying,
  type RunRow,
} from "./db.js";

/** Root config that creates the workshop's GCP project. */
const GCP_TF_SOURCE = "workshops/gcp-base";

/** Destroy every run past its TTL. Runs sequentially within this container. */
export async function reap(): Promise<void> {
  const runs = await expiredRuns();
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
    if (run.clouds.includes("gcp")) {
      await destroyGcp(run);
    }

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

    await setDestroyed(run.id);
    await log(run.id, "system", "Destroyed.");
  } catch (err) {
    // Leave the run for the next reaper tick to retry.
    const message = err instanceof Error ? err.message : String(err);
    await log(run.id, "stderr", `destroy failed, will retry: ${message}`);
    console.error(`reaper: failed to destroy ${run.id}:`, message);
  }
}

async function destroyGcp(run: RunRow): Promise<void> {
  const cfg = gcpCfg();
  const workDir = path.join(TF_ROOT, GCP_TF_SOURCE);
  const projectId = run.gcp_project_id ?? makeProjectId(run.slug, run.id);

  await log(run.id, "system", `Destroying GCP project ${projectId}`);
  writeTfvars(workDir, projectId, run.id);
  await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
    log(run.id, l.stream, l.text),
  );
  await tfDestroy(workDir, (l) => log(run.id, l.stream, l.text));
}

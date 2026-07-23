import path from "node:path";
import { cfg, TF_ROOT, makeProjectId } from "./config.js";
import { writeTfvars } from "./workspace.js";
import { tfDestroy, tfInit } from "./terraform.js";
import {
  expiredRuns,
  log,
  setDestroyed,
  setDestroying,
  type RunRow,
} from "./db.js";

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
  const workDir = path.join(TF_ROOT, run.tf_source);
  const projectId = run.gcp_project_id ?? makeProjectId(run.slug, run.id);

  try {
    await setDestroying(run.id);
    await log(run.id, "system", `Destroying project ${projectId}`);

    writeTfvars(workDir, projectId, run.id);
    await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
      log(run.id, l.stream, l.text),
    );
    await tfDestroy(workDir, (l) => log(run.id, l.stream, l.text));

    await setDestroyed(run.id);
    await log(run.id, "system", "Destroyed.");
  } catch (err) {
    // Leave the run for the next reaper tick to retry.
    const message = err instanceof Error ? err.message : String(err);
    await log(run.id, "stderr", `destroy failed, will retry: ${message}`);
    console.error(`reaper: failed to destroy ${run.id}:`, message);
  }
}

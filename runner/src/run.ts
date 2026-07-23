import path from "node:path";
import { cfg, TF_ROOT, makeProjectId } from "./config.js";
import { writeTfvars } from "./workspace.js";
import { tfApply, tfInit, tfOutput } from "./terraform.js";
import {
  getRun,
  log,
  setApplying,
  setFailed,
  setProvisioning,
  setReady,
} from "./db.js";

/** Provision one workshop run end to end. */
export async function runWorkshop(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);

  const workDir = path.join(TF_ROOT, run.tf_source);
  const projectId = run.gcp_project_id ?? makeProjectId(run.slug, run.id);

  try {
    await setProvisioning(runId, projectId);
    await log(runId, "system", `Provisioning "${run.title}" as project ${projectId}`);

    writeTfvars(workDir, projectId, runId);

    await log(runId, "system", "terraform init");
    await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
      log(runId, l.stream, l.text),
    );

    await setApplying(runId);
    await log(runId, "system", "terraform apply — creating project, billing, APIs, resources");
    await tfApply(workDir, (l) => log(runId, l.stream, l.text));

    const outputs = await tfOutput(workDir);
    const expiresAt = new Date(Date.now() + run.ttl_seconds * 1000);
    await setReady(runId, outputs, expiresAt);
    await log(
      runId,
      "system",
      `Ready. Auto-destroys at ${expiresAt.toISOString()}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(runId, "stderr", message);
    // Expire immediately so the reaper cleans up any partial resources.
    await setFailed(runId, message, new Date());
    throw err;
  }
}

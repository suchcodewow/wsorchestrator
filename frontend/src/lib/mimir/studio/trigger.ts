/**
 * Starts the `mimir-studio` job on a queued job's row. On Cloud Run that is an
 * execution of the job named by `MIMIR_STUDIO_JOB`, given the row's id, as the
 * runner is started (`lib/trigger.ts`). Under `npm run dev` with no job named,
 * it runs the studio from this checkout instead, in the background, so a
 * developer can try it with their own keys; its output goes to a log file
 * named in the job's progress.
 */

import "server-only";

import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { GoogleAuth } from "google-auth-library";
import { failJob } from "./jobs";

/** Whether this deployment can run studio jobs at all. */
export const studioConfigured = () =>
  Boolean(process.env.MIMIR_STUDIO_JOB && process.env.GCP_ADMIN_PROJECT_ID) || process.env.NODE_ENV === "development";

async function runOnCloudRun(jobId: string): Promise<void> {
  const job = process.env.MIMIR_STUDIO_JOB!;
  const project = process.env.GCP_ADMIN_PROJECT_ID!;
  const region = process.env.GCP_REGION ?? "us-central1";
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  await client.request({
    url: `https://${region}-run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`,
    method: "POST",
    data: { overrides: { containerOverrides: [{ env: [{ name: "JOB_ID", value: jobId }] }] } },
  });
}

function runLocally(jobId: string): void {
  // `next dev` runs from frontend/, and the studio sits beside it.
  const studio = path.resolve(process.cwd(), "../scripts/explainer-video");
  const log = path.join(os.tmpdir(), `mimir-studio-${jobId}.log`);
  const out = openSync(log, "a");
  const child = spawn("npx", ["tsx", "studio/index.ts", jobId], { cwd: studio, detached: true, stdio: ["ignore", out, out], env: process.env });
  child.unref();
  console.log(`mimir studio: job ${jobId} running locally, logging to ${log}`);
}

/** Starts the job; if it cannot be, marks it failed with why, and returns false. */
export async function runStudioJob(jobId: string): Promise<boolean> {
  try {
    if (process.env.MIMIR_STUDIO_JOB && process.env.GCP_ADMIN_PROJECT_ID) await runOnCloudRun(jobId);
    else if (process.env.NODE_ENV === "development") runLocally(jobId);
    else throw new Error("MIMIR_STUDIO_JOB and GCP_ADMIN_PROJECT_ID are not set");
    return true;
  } catch (err) {
    await failJob(jobId, `Could not start the studio: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

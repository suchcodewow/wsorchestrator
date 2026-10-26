/**
 * The `mimir-studio` job: one execution does one row of `mimir_studio_jobs`,
 * named by `JOB_ID` (Cloud Run) or the first argument (`npm run job -- <id>`).
 * A deck job drafts a new concept map from an uploaded deck; a video job makes
 * one concept's explainer video. See `deck.ts` and `video.ts`.
 */

import { runDeck } from "./deck.js";
import { claimJob, failJob, heartbeat, pool, recordAudit } from "./db.js";
import { runVideo } from "./video.js";

const jobId = process.env.JOB_ID || process.argv[2];
if (!jobId) {
  console.error("Usage: tsx studio/index.ts <job id> (or set JOB_ID)");
  process.exit(2);
}

let code = 0;
const job = await claimJob(jobId);
if (!job) {
  console.log(`Job ${jobId} is not queued; nothing to do.`);
} else {
  console.log(`Job ${job.id}: ${job.kind}, ${job.label}`);
  // Every tool call, however long, leaves the row looking alive to the app.
  const beat = setInterval(() => void heartbeat(job.id).catch(() => {}), 5 * 60 * 1000);
  try {
    if (job.kind === "deck") await runDeck(job);
    else await runVideo(job);
    console.log(`Job ${job.id} finished.`);
  } catch (err) {
    code = 1;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Job ${job.id} failed:`, err);
    await failJob(job.id, message);
    await recordAudit(`studio.${job.kind}.fail`, `The studio could not finish ${job.label}.`, job.concept_id ?? job.id, job.label, "failed", {
      jobId: job.id,
      error: message.slice(0, 1000),
    });
  } finally {
    clearInterval(beat);
  }
}
await pool.end();
process.exit(code);

/** Starts the runner job that provisions or converges an event. */

import { and, eq } from "drizzle-orm";
import { GoogleAuth } from "google-auth-library";
import { db } from "@/db";
import { runLogs, workshopRuns } from "@/db/schema";
import { ownedBy, type Viewer } from "@/lib/runs";

async function triggerRunnerJob(runId: string): Promise<void> {
  const job = process.env.TF_RUNNER_JOB;
  const project = process.env.GCP_ADMIN_PROJECT_ID;
  const region = process.env.GCP_REGION ?? "us-central1";
  const missing = [
    !job && "TF_RUNNER_JOB",
    !project && "GCP_ADMIN_PROJECT_ID",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`${missing.join(" and ")} not set`);
  }

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const url = `https://${region}-run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`;
  await client.request({
    url,
    method: "POST",
    data: {
      overrides: {
        containerOverrides: [{ env: [{ name: "RUN_ID", value: runId }] }],
      },
    },
  });
}

export async function reprovisionRun(runId: string): Promise<boolean> {
  const claimed = await db
    .update(workshopRuns)
    .set({ status: "requested" })
    .where(and(eq(workshopRuns.id, runId), eq(workshopRuns.status, "ready")))
    .returning({ id: workshopRuns.id });

  if (claimed.length === 0) return false;

  try {
    await triggerRunnerJob(runId);
    await db.insert(runLogs).values({
      runId,
      stream: "system",
      message: "Applying the updated configuration.",
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(workshopRuns)
      .set({ status: "ready" })
      .where(eq(workshopRuns.id, runId));
    await db.insert(runLogs).values({
      runId,
      stream: "stderr",
      message: `Saved, but could not apply the change now (${message}) — the live environment is unchanged.`,
    });
    return false;
  }
}

export type RetryRunError = "not_found" | "not_retryable" | "trigger_failed";

export async function retryRun(
  runId: string,
  viewer: Viewer,
): Promise<{ ok: true } | { ok: false; error: RetryRunError }> {
  const claimed = await db
    .update(workshopRuns)
    .set({ status: "requested", error: null })
    .where(
      and(
        eq(workshopRuns.id, runId),
        eq(workshopRuns.status, "failed"),
        ownedBy(viewer),
      ),
    )
    .returning({ id: workshopRuns.id });

  if (claimed.length === 0) {
    const exists = await db.query.workshopRuns.findFirst({
      where: and(eq(workshopRuns.id, runId), ownedBy(viewer)),
      columns: { id: true },
    });
    return { ok: false, error: exists ? "not_retryable" : "not_found" };
  }

  try {
    await triggerRunnerJob(runId);
    await db.insert(runLogs).values({
      runId,
      stream: "system",
      message: "Retry requested — provisioning again.",
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(workshopRuns)
      .set({ status: "failed", error: message })
      .where(eq(workshopRuns.id, runId));
    await db.insert(runLogs).values({
      runId,
      stream: "stderr",
      message: `Could not start the retry (${message}) — nothing was changed, so try again.`,
    });
    return { ok: false, error: "trigger_failed" };
  }
}

export async function startRunNow(runId: string): Promise<boolean> {
  const claimed = await db
    .update(workshopRuns)
    .set({ status: "requested" })
    .where(and(eq(workshopRuns.id, runId), eq(workshopRuns.status, "scheduled")))
    .returning({ id: workshopRuns.id });

  if (claimed.length === 0) return false;

  try {
    await triggerRunnerJob(runId);
    await db.insert(runLogs).values({
      runId,
      stream: "system",
      message: "Start requested — provisioning now.",
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(workshopRuns)
      .set({ status: "scheduled" })
      .where(eq(workshopRuns.id, runId));
    await db.insert(runLogs).values({
      runId,
      stream: "stderr",
      message: `Could not start immediately (${message}) — the scheduler will pick this up.`,
    });
    return false;
  }
}

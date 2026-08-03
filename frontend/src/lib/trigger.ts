import { and, eq } from "drizzle-orm";
import { GoogleAuth } from "google-auth-library";
import { db } from "@/db";
import { runLogs, workshopRuns } from "@/db/schema";
import { ownedBy, type Viewer } from "@/lib/runs";

/**
 * Execute the tf-runner Cloud Run Job for one run, passing RUN_ID as a
 * container override. Runs as the app service account, which holds
 * roles/run.developer on the job (plain invoker lacks runWithOverrides).
 */
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

/**
 * Converge a live workshop after its configuration grew. Claims it out of
 * `ready` so the reaper can't pick it up mid-flight, then re-runs the runner:
 * account creation skips addresses that already exist, and `terraform apply`
 * is convergent, so this only adds what is missing.
 *
 * If the trigger fails the run is put back to `ready` — the saved config then
 * differs from what is deployed until it is provisioned again.
 */
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
      message: `Saved, but could not apply the change now (${message}). The live environment is unchanged.`,
    });
    return false;
  }
}

export type RetryRunError = "not_found" | "not_retryable" | "trigger_failed";

/**
 * Re-run a first provision that failed.
 *
 * A failed run left its resources half-built and sat on the calendar for
 * exactly this — `runWorkshop` is convergent (an existing OU and accounts are
 * adopted, `terraform apply` only adds what is missing), so a retry finishes
 * what the failure interrupted rather than starting over.
 *
 * The claim is a single atomic update guarded by ownership *and* `failed`
 * status, so it doubles as the authorization check and the race guard: only a
 * failed run the viewer may act on flips to `requested`, and a second click (or
 * the scheduler) can't provision it twice. The stale `error` is cleared in the
 * same write so the page stops showing it the moment the retry starts. If the
 * trigger itself fails, the run is put back to `failed` with that reason.
 *
 * Only first-provision failures reach `failed`; a live workshop whose grow
 * failed is left `ready` (see `setLiveError` in the runner), so this never
 * touches a workshop that still has healthy resources.
 */
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
    // Tell "not yours / gone" apart from "not in a failed state", so the UI can
    // 404 the first and explain the second — the same split extend/delete make.
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
      message: `Could not start the retry (${message}). Nothing was changed; try again.`,
    });
    return { ok: false, error: "trigger_failed" };
  }
}

/**
 * Start a run right now instead of waiting for the scheduler's next tick.
 *
 * The run is claimed with the same atomic `status = 'scheduled'` guard the
 * scheduler uses, so the two can never provision the same run twice. If the
 * trigger fails — no `tf-runner` job configured, as in local dev — the run is
 * put back to `scheduled` and the scheduler picks it up normally.
 */
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

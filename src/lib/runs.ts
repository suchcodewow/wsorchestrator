import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runLogs, workshopRuns, workshops } from "@/db/schema";

/**
 * Create a workshop run for a user and hand it off to the Terraform runner.
 *
 * The row is created in `requested`; the runner (Cloud Run Job) advances it
 * through provisioning -> applying -> ready and writes logs/outputs back.
 */
export async function createRun(workshopId: string, userId: string) {
  const workshop = await db.query.workshops.findFirst({
    where: eq(workshops.id, workshopId),
  });
  if (!workshop || !workshop.enabled) {
    return { error: "workshop_not_found" as const };
  }

  const runId = crypto.randomUUID();
  const statePrefix = `workshops/${workshopId}/${runId}`;

  const [run] = await db
    .insert(workshopRuns)
    .values({
      id: runId,
      workshopId,
      userId,
      status: "requested",
      statePrefix,
    })
    .returning();

  await db.insert(runLogs).values({
    runId,
    stream: "system",
    message: `Run requested for "${workshop.title}". Queued for provisioning.`,
  });

  // Kick off the tf-runner Cloud Run Job for this run. The job assumes
  // runner-sa and drives provisioning; failures here are non-fatal (the run
  // stays `requested` and can be retried).
  await triggerRunnerJob(run.id);

  return { run };
}

/**
 * Execute the `tf-runner` Cloud Run Job with a RUN_ID override, using the
 * app-sa's ambient credentials (Workload Identity on Cloud Run). No-ops with a
 * warning when the runner isn't configured (e.g. local dev).
 */
async function triggerRunnerJob(runId: string): Promise<void> {
  const job = process.env.TF_RUNNER_JOB;
  const project = process.env.GCP_ADMIN_PROJECT_ID;
  const region = process.env.GCP_REGION ?? "us-central1";

  if (!job || !project) {
    console.warn(
      `runner job not configured (TF_RUNNER_JOB/GCP_ADMIN_PROJECT_ID); ` +
        `run ${runId} left in 'requested'`,
    );
    return;
  }

  try {
    const { GoogleAuth } = await import("google-auth-library");
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
          containerOverrides: [
            { env: [{ name: "RUN_ID", value: runId }] },
          ],
        },
      },
    });
  } catch (err) {
    console.error(`failed to trigger runner job for run ${runId}:`, err);
  }
}

export async function listRunsForUser(userId: string) {
  return db.query.workshopRuns.findMany({
    where: eq(workshopRuns.userId, userId),
    orderBy: desc(workshopRuns.createdAt),
  });
}

export async function getRunForUser(runId: string, userId: string) {
  const run = await db.query.workshopRuns.findFirst({
    where: and(eq(workshopRuns.id, runId), eq(workshopRuns.userId, userId)),
  });
  if (!run) return null;

  const logs = await db.query.runLogs.findMany({
    where: eq(runLogs.runId, runId),
    orderBy: runLogs.id,
  });
  return { run, logs };
}

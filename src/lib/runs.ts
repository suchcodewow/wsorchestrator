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

  // TODO(runner): trigger the `tf-runner` Cloud Run Job execution with
  // { runId, workshopId, tfSource, variables, statePrefix, ttlSeconds }.
  // The job assumes runner-sa via Workload Identity and drives the run.
  await triggerRunnerJob(run.id);

  return { run };
}

/** Placeholder for kicking off the Cloud Run Job. Wired up in step #3. */
async function triggerRunnerJob(runId: string): Promise<void> {
  void runId;
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

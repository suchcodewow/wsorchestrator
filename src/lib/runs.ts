import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runLogs, workshopRuns, workshops } from "@/db/schema";

/**
 * Schedule a workshop for a user. The run is created in `scheduled` with a
 * start time; the `tf-scheduler` job auto-provisions it once that time arrives.
 */
export async function createScheduledRun(input: {
  name: string;
  workshopId: string;
  userId: string;
  scheduledStart: Date;
}) {
  const workshop = await db.query.workshops.findFirst({
    where: eq(workshops.id, input.workshopId),
  });
  if (!workshop || !workshop.enabled) {
    return { error: "workshop_not_found" as const };
  }

  const runId = crypto.randomUUID();
  const statePrefix = `workshops/${input.workshopId}/${runId}`;

  const [run] = await db
    .insert(workshopRuns)
    .values({
      id: runId,
      workshopId: input.workshopId,
      userId: input.userId,
      name: input.name,
      status: "scheduled",
      scheduledStart: input.scheduledStart,
      statePrefix,
    })
    .returning();

  await db.insert(runLogs).values({
    runId,
    stream: "system",
    message: `Scheduled "${input.name}" (${workshop.title}) for ${input.scheduledStart.toISOString()}.`,
  });

  return { run };
}

export async function listRunsForUser(userId: string) {
  return db.query.workshopRuns.findMany({
    where: eq(workshopRuns.userId, userId),
    orderBy: desc(workshopRuns.createdAt),
  });
}

/** Runs for a user joined with their workshop title, for the calendar. */
export async function listCalendarRuns(userId: string) {
  return db
    .select({
      id: workshopRuns.id,
      name: workshopRuns.name,
      status: workshopRuns.status,
      scheduledStart: workshopRuns.scheduledStart,
      workshopTitle: workshops.title,
    })
    .from(workshopRuns)
    .innerJoin(workshops, eq(workshopRuns.workshopId, workshops.id))
    .where(eq(workshopRuns.userId, userId))
    .orderBy(desc(workshopRuns.scheduledStart));
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

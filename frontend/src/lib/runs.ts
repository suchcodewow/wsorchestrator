import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  CLOUD_LABELS,
  editabilityOf,
  limitsFor,
  runLogs,
  workshopAccounts,
  workshopRuns,
  type Cloud,
  type EventMode,
  type WorkshopRun,
} from "@/db/schema";

/**
 * Slugify a workshop name for use in account addresses and project ids:
 * lowercase, non-alphanumerics collapsed to single dashes.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    // Drop the combining marks NFKD split off, so "é" becomes "e" not "e-".
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "workshop";
}

/**
 * Schedule a workshop for a user. The run is created in `scheduled` with a
 * start time; the `tf-scheduler` job auto-provisions it once that time arrives.
 */
export async function createScheduledRun(input: {
  name: string;
  mode: EventMode;
  userCount: number;
  clouds: Cloud[];
  userId: string;
  scheduledStart: Date;
  /** Started from "Start now" rather than booked for a future time. */
  startNow?: boolean;
}) {
  const runId = crypto.randomUUID();

  const [run] = await db
    .insert(workshopRuns)
    .values({
      id: runId,
      userId: input.userId,
      name: input.name,
      mode: input.mode,
      slug: slugify(input.name),
      userCount: input.userCount,
      clouds: input.clouds,
      status: "scheduled",
      scheduledStart: input.scheduledStart,
      statePrefix: `workshops/${runId}`,
    })
    .returning();

  const clouds =
    input.clouds.length > 0
      ? input.clouds.map((c) => CLOUD_LABELS[c]).join(", ")
      : "no clouds";

  const when = input.startNow
    ? "to start now"
    : `for ${input.scheduledStart.toISOString()}`;

  await db.insert(runLogs).values({
    runId,
    stream: "system",
    message:
      `Scheduled ${input.mode} "${input.name}" ${when} — ` +
      `${input.userCount} user(s), ${clouds}.`,
  });

  return { run };
}

export type UpdateRunError =
  | "not_found"
  | "locked"
  | "shrink_not_allowed"
  | "cloud_removal_not_allowed"
  | "exceeds_mode_limits";

/**
 * Change a run's attendee count and clouds. Returns whether the change needs
 * the runner to converge the live environment (only true for a `ready` run).
 */
export async function updateRunConfig(
  runId: string,
  userId: string,
  input: { userCount: number; clouds: Cloud[] },
): Promise<
  | { ok: true; run: WorkshopRun; needsReprovision: boolean }
  | { ok: false; error: UpdateRunError }
> {
  const run = await db.query.workshopRuns.findFirst({
    where: and(eq(workshopRuns.id, runId), eq(workshopRuns.userId, userId)),
  });
  if (!run) return { ok: false, error: "not_found" };

  const editability = editabilityOf(run.status);
  if (editability === "locked") return { ok: false, error: "locked" };

  const clouds = [...new Set(input.clouds)];

  // The mode's caps are re-checked here rather than in the route schema: the
  // request says nothing about the mode, so only the stored run can decide
  // whether five users and one cloud is the ceiling or fifty and three.
  const limits = limitsFor(run.mode);
  if (
    input.userCount < 1 ||
    input.userCount > limits.maxUsers ||
    clouds.length < 1 ||
    clouds.length > limits.maxClouds
  ) {
    return { ok: false, error: "exceeds_mode_limits" };
  }

  if (editability === "grow") {
    if (input.userCount < run.userCount) {
      return { ok: false, error: "shrink_not_allowed" };
    }
    const removed = run.clouds.filter((c) => !clouds.includes(c));
    if (removed.length > 0) {
      return { ok: false, error: "cloud_removal_not_allowed" };
    }
  }

  const addedUsers = input.userCount - run.userCount;
  const addedClouds = clouds.filter((c) => !run.clouds.includes(c));
  const removedClouds = run.clouds.filter((c) => !clouds.includes(c));
  const changed =
    addedUsers !== 0 || addedClouds.length > 0 || removedClouds.length > 0;

  if (!changed) return { ok: true, run, needsReprovision: false };

  const [updated] = await db
    .update(workshopRuns)
    .set({ userCount: input.userCount, clouds })
    .where(eq(workshopRuns.id, runId))
    .returning();

  const parts: string[] = [];
  if (addedUsers > 0) parts.push(`+${addedUsers} user(s)`);
  if (addedUsers < 0) parts.push(`${addedUsers} user(s)`);
  if (addedClouds.length > 0) {
    parts.push(`added ${addedClouds.map((c) => CLOUD_LABELS[c]).join(", ")}`);
  }
  if (removedClouds.length > 0) {
    parts.push(`removed ${removedClouds.map((c) => CLOUD_LABELS[c]).join(", ")}`);
  }

  await db.insert(runLogs).values({
    runId,
    stream: "system",
    message: `Configuration updated: ${parts.join("; ")}. Now ${input.userCount} user(s), ${clouds
      .map((c) => CLOUD_LABELS[c])
      .join(", ")}.`,
  });

  return { ok: true, run: updated, needsReprovision: editability === "grow" };
}

export async function listRunsForUser(userId: string) {
  return db.query.workshopRuns.findMany({
    where: eq(workshopRuns.userId, userId),
    orderBy: desc(workshopRuns.createdAt),
  });
}

/** Runs for a user, for the calendar. */
export async function listCalendarRuns(userId: string) {
  return db
    .select({
      id: workshopRuns.id,
      name: workshopRuns.name,
      mode: workshopRuns.mode,
      status: workshopRuns.status,
      scheduledStart: workshopRuns.scheduledStart,
      userCount: workshopRuns.userCount,
      clouds: workshopRuns.clouds,
    })
    .from(workshopRuns)
    .where(eq(workshopRuns.userId, userId))
    .orderBy(desc(workshopRuns.scheduledStart));
}

export async function getRunForUser(runId: string, userId: string) {
  const run = await db.query.workshopRuns.findFirst({
    where: and(eq(workshopRuns.id, runId), eq(workshopRuns.userId, userId)),
  });
  if (!run) return null;

  const [logs, accounts] = await Promise.all([
    db.query.runLogs.findMany({
      where: eq(runLogs.runId, runId),
      orderBy: runLogs.id,
    }),
    db.query.workshopAccounts.findMany({
      where: eq(workshopAccounts.runId, runId),
      orderBy: workshopAccounts.id,
    }),
  ]);
  return { run, logs, accounts };
}

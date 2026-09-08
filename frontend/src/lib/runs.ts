/** Books, reconfigures, extends and deletes events. */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  CLOUD_LABELS,
  DAY_SECONDS,
  EXTENSION_SECONDS,
  editabilityOf,
  limitsFor,
  runLogs,
  runResources,
  users,
  workshopAccounts,
  workshopRuns,
  type CalendarScope,
  type Cloud,
  type EventMode,
  type SiteRole,
  type WorkshopRun,
} from "@/db/schema";
import { canManageAnyEvent, canSeeAllEvents } from "@/lib/roles";

export type Viewer = { id: string; role: SiteRole };

export const ownedBy = (viewer: Viewer) =>
  canManageAnyEvent(viewer.role)
    ? undefined
    : eq(workshopRuns.userId, viewer.id);

export function slugify(name: string, fallback = "workshop"): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : fallback;
}

function humanDuration(seconds: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (seconds % 86400 === 0) return plural(seconds / 86400, "day");
  if (seconds % 3600 === 0) return plural(seconds / 3600, "hour");
  return plural(Math.round(seconds / 60), "minute");
}

export async function createScheduledRun(input: {
  name: string;
  mode: EventMode;
  userCount: number;
  clouds: Cloud[];
  userId: string;
  scheduledStart: Date;
  ttlSeconds: number;
  startNow?: boolean;
  harnessOnly?: boolean;
  componentSetId?: string;
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
      ttlSeconds: input.ttlSeconds,
      statePrefix: `workshops/${runId}`,
      harnessOnly: input.harnessOnly ?? false,
      componentSetId: input.componentSetId ?? null,
    })
    .returning();

  const clouds = input.harnessOnly
    ? "Harness only"
    : input.clouds.length > 0
      ? input.clouds.map((c) => CLOUD_LABELS[c]).join(", ")
      : "no clouds";

  const when = input.startNow
    ? "to start now"
    : `for ${input.scheduledStart.toISOString()}`;

  const lifetime = `runs ${humanDuration(input.ttlSeconds)} before teardown`;

  await db.insert(runLogs).values({
    runId,
    stream: "system",
    message:
      `Scheduled ${input.mode} "${input.name}" ${when} — ` +
      `${input.userCount} user(s), ${clouds}, ${lifetime}.`,
  });

  return { run };
}

export type UpdateRunError =
  | "not_found"
  | "locked"
  | "shrink_not_allowed"
  | "cloud_removal_not_allowed"
  | "exceeds_mode_limits";

export async function updateRunConfig(
  runId: string,
  viewer: Viewer,
  input: { userCount: number; clouds: Cloud[] },
): Promise<
  | { ok: true; run: WorkshopRun; needsReprovision: boolean }
  | { ok: false; error: UpdateRunError }
> {
  const run = await db.query.workshopRuns.findFirst({
    where: and(eq(workshopRuns.id, runId), ownedBy(viewer)),
  });
  if (!run) return { ok: false, error: "not_found" };

  const editability = editabilityOf(run.status);
  if (editability === "locked") return { ok: false, error: "locked" };

  const clouds = [...new Set(input.clouds)];

  const limits = limitsFor(run.mode);
  if (
    input.userCount < 1 ||
    input.userCount > limits.maxUsers ||
    clouds.length < limits.minClouds ||
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
    message: `Configuration updated: ${parts.join("; ")} — now ${input.userCount} user(s), ${clouds
      .map((c) => CLOUD_LABELS[c])
      .join(", ")}.`,
  });

  return { ok: true, run: updated, needsReprovision: editability === "grow" };
}

export type ExtendRunError = "not_found" | "not_extendable";

export async function extendRun(
  runId: string,
  viewer: Viewer,
): Promise<
  { ok: true; run: WorkshopRun } | { ok: false; error: ExtendRunError }
> {
  const run = await db.query.workshopRuns.findFirst({
    where: and(eq(workshopRuns.id, runId), ownedBy(viewer)),
  });
  if (!run) return { ok: false, error: "not_found" };

  const gone =
    run.deleteRequested ||
    run.status === "destroying" ||
    run.status === "destroy_failed" ||
    run.status === "destroyed" ||
    run.status === "failed";
  if (gone) return { ok: false, error: "not_extendable" };

  const [updated] = await db
    .update(workshopRuns)
    .set(
      run.expiresAt
        ? { expiresAt: new Date(run.expiresAt.getTime() + EXTENSION_SECONDS * 1000) }
        : { ttlSeconds: run.ttlSeconds + EXTENSION_SECONDS },
    )
    .where(eq(workshopRuns.id, runId))
    .returning();

  const extraDays = EXTENSION_SECONDS / DAY_SECONDS;
  await db.insert(runLogs).values({
    runId,
    stream: "system",
    message: updated.expiresAt
      ? `Extended by ${extraDays} day — now auto-destroys at ${updated.expiresAt.toISOString()}.`
      : `Extended by ${extraDays} day — lifetime is now ${humanDuration(
          updated.ttlSeconds,
        )} once it starts.`,
  });

  return { ok: true, run: updated };
}

export type EndRunError = "not_found" | "not_running";

/**
 * Bring a live event's end time forward to now, so the reaper tears it down on
 * its next tick exactly as it would have at the hour it was booked for.
 *
 * Only a `ready` run qualifies, because `expires_at` is what the reaper reads
 * and it reads it only for that status (see `reapableRuns`): moving it on a row
 * in any other state would report success and destroy nothing. Nor is
 * `deleteRequested` set — the point is an ordinary teardown, which leaves the
 * run and its build log on record afterwards. Deleting is a separate button.
 */
export async function endRunNow(
  runId: string,
  viewer: Viewer,
): Promise<{ ok: true; run: WorkshopRun } | { ok: false; error: EndRunError }> {
  const run = await db.query.workshopRuns.findFirst({
    where: and(eq(workshopRuns.id, runId), ownedBy(viewer)),
  });
  if (!run) return { ok: false, error: "not_found" };
  if (run.status !== "ready" || run.deleteRequested) {
    return { ok: false, error: "not_running" };
  }

  const [updated] = await db
    .update(workshopRuns)
    .set({ expiresAt: new Date() })
    .where(eq(workshopRuns.id, runId))
    .returning();

  await db.insert(runLogs).values({
    runId,
    stream: "system",
    message:
      "Ended early — the end time is now, so teardown starts within a few " +
      "minutes and runs as it would have at the scheduled end.",
  });

  return { ok: true, run: updated };
}

export async function listRunsForUser(userId: string) {
  return db.query.workshopRuns.findMany({
    where: eq(workshopRuns.userId, userId),
    orderBy: desc(workshopRuns.createdAt),
  });
}

export async function listCalendarRuns(
  viewer: Viewer,
  scope: CalendarScope = "own",
) {
  const showAll = scope === "all" && canSeeAllEvents(viewer.role);

  return db
    .select({
      id: workshopRuns.id,
      name: workshopRuns.name,
      mode: workshopRuns.mode,
      status: workshopRuns.status,
      scheduledStart: workshopRuns.scheduledStart,
      ttlSeconds: workshopRuns.ttlSeconds,
      expiresAt: workshopRuns.expiresAt,
      userCount: workshopRuns.userCount,
      clouds: workshopRuns.clouds,
      ownerId: workshopRuns.userId,
      ownerName: users.name,
      ownerEmail: users.email,
    })
    .from(workshopRuns)
    .innerJoin(users, eq(users.id, workshopRuns.userId))
    .where(showAll ? undefined : eq(workshopRuns.userId, viewer.id))
    .orderBy(desc(workshopRuns.scheduledStart));
}

export async function getRunForViewer(runId: string, viewer: Viewer) {
  const run = await db.query.workshopRuns.findFirst({
    where: and(eq(workshopRuns.id, runId), ownedBy(viewer)),
  });
  if (!run) return null;

  const [logs, accounts, resources, owner] = await Promise.all([
    db.query.runLogs.findMany({
      where: eq(runLogs.runId, runId),
      orderBy: runLogs.id,
    }),
    db.query.workshopAccounts.findMany({
      where: eq(workshopAccounts.runId, runId),
      orderBy: workshopAccounts.id,
    }),
    db.query.runResources.findMany({
      where: eq(runResources.runId, runId),
      orderBy: runResources.id,
    }),
    db.query.users.findFirst({
      where: eq(users.id, run.userId),
      columns: { id: true, name: true, email: true },
    }),
  ]);
  return { run, logs, accounts, resources, owner: owner ?? null };
}

export type DeleteRunError = "not_found" | "in_flight";

export type DeleteRunOutcome = "deleted" | "teardown_requested";

const IN_FLIGHT = new Set(["requested", "provisioning", "applying"]);

const NOTHING_TO_TEAR_DOWN = new Set(["scheduled", "destroyed"]);

/** Hand a teardown back to the reaper for one fresh attempt. */
const DESTROY_RESET = {
  status: "destroying" as const,
  // Released so `claimDestroy` reads the run as unclaimed; leaving it set would
  // make the next tick mistake this retry for an attempt that died.
  destroyStartedAt: null,
  error: null,
};

export async function deleteRun(
  runId: string,
  viewer: Viewer,
): Promise<
  { ok: true; outcome: DeleteRunOutcome } | { ok: false; error: DeleteRunError }
> {
  const run = await db.query.workshopRuns.findFirst({
    where: and(eq(workshopRuns.id, runId), ownedBy(viewer)),
  });
  if (!run) return { ok: false, error: "not_found" };

  if (IN_FLIGHT.has(run.status)) return { ok: false, error: "in_flight" };

  if (NOTHING_TO_TEAR_DOWN.has(run.status)) {
    await db.delete(workshopRuns).where(eq(workshopRuns.id, runId));
    return { ok: true, outcome: "deleted" };
  }

  await db
    .update(workshopRuns)
    .set({ deleteRequested: true, ...DESTROY_RESET })
    .where(eq(workshopRuns.id, runId));

  await db.insert(runLogs).values({
    runId,
    stream: "system",
    message:
      run.status === "destroy_failed"
        ? "Deletion requested — the teardown is being retried from the start."
        : "Deletion requested — tearing down accounts, org unit, and cloud " +
          "resources first.",
  });

  return { ok: true, outcome: "teardown_requested" };
}

export type RetryTeardownError = "not_found" | "not_retryable";

export async function retryTeardown(
  runId: string,
  viewer: Viewer,
): Promise<
  { ok: true; run: WorkshopRun } | { ok: false; error: RetryTeardownError }
> {
  const run = await db.query.workshopRuns.findFirst({
    where: and(eq(workshopRuns.id, runId), ownedBy(viewer)),
  });
  if (!run) return { ok: false, error: "not_found" };
  if (run.status !== "destroy_failed") {
    return { ok: false, error: "not_retryable" };
  }

  const [updated] = await db
    .update(workshopRuns)
    .set(DESTROY_RESET)
    .where(eq(workshopRuns.id, runId))
    .returning();

  await db.insert(runLogs).values({
    runId,
    stream: "system",
    message:
      "Teardown retry requested — this starts again from the top within a " +
      "few minutes.",
  });

  return { ok: true, run: updated };
}

export async function countRunsForUsers(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      userId: workshopRuns.userId,
      count: sql<number>`count(*)::int`,
    })
    .from(workshopRuns)
    .groupBy(workshopRuns.userId);

  return new Map(rows.map((r) => [r.userId, r.count]));
}

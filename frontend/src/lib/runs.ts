import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  CLOUD_LABELS,
  DAY_SECONDS,
  EXTENSION_SECONDS,
  editabilityOf,
  limitsFor,
  runLogs,
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

/**
 * Who is asking. Every read and write below takes one instead of a bare user
 * id, so "is this mine?" and "am I allowed to reach past mine?" are answered
 * in the same place rather than at each call site.
 */
export type Viewer = { id: string; role: SiteRole };

/**
 * The rows a viewer may act on: their own, or everyone's for a manager and
 * above. Composed into a `where` alongside the run id, so an operator asking
 * for somebody else's run gets the same "not found" as one asking for a run
 * that never existed.
 */
const ownedBy = (viewer: Viewer) =>
  canManageAnyEvent(viewer.role)
    ? undefined
    : eq(workshopRuns.userId, viewer.id);

/**
 * Slugify a workshop name for use in account addresses and project ids:
 * lowercase, non-alphanumerics collapsed to single dashes.
 *
 * `fallback` is what a name made entirely of punctuation collapses to — the
 * result is an identifier, so it can never be empty. Lab guide slugs are built
 * with the same rules and only differ in that word.
 */
export function slugify(name: string, fallback = "workshop"): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    // Drop the combining marks NFKD split off, so "é" becomes "e" not "e-".
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : fallback;
}

/** A lifetime in seconds as the largest whole unit it divides into evenly. */
function humanDuration(seconds: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (seconds % 86400 === 0) return plural(seconds / 86400, "day");
  if (seconds % 3600 === 0) return plural(seconds / 3600, "hour");
  return plural(Math.round(seconds / 60), "minute");
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
  /** How long the event lives before teardown, in seconds. */
  ttlSeconds: number;
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
      ttlSeconds: input.ttlSeconds,
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

/**
 * Change a run's attendee count and clouds. Returns whether the change needs
 * the runner to converge the live environment (only true for a `ready` run).
 */
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

export type ExtendRunError = "not_found" | "not_extendable";

/**
 * Grant an event one more day before teardown.
 *
 * Where the extra day lands depends on how far along the run is:
 *   * `ready`/`failed` already have an `expiresAt` the reaper watches, so the
 *     day is added there.
 *   * A `scheduled` or in-flight run has no expiry yet — `runWorkshop` computes
 *     it from `ttlSeconds` when it goes ready — so the day is added to that
 *     instead, and carries through when the expiry is finally set.
 *
 * A run that is tearing down, gone, or failed can't be extended: its resources
 * are on their way out (a failed run is expired on the spot so the reaper
 * cleans up whatever it half-built) and there is nothing left to keep alive.
 */
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

export async function listRunsForUser(userId: string) {
  return db.query.workshopRuns.findMany({
    where: eq(workshopRuns.userId, userId),
    orderBy: desc(workshopRuns.createdAt),
  });
}

/**
 * Runs for the calendar. `scope: "all"` widens it to every user's events —
 * honoured only for a manager and above, so a stale preference on a demoted
 * account quietly falls back to their own.
 *
 * The owner is joined in either way: at `own` scope the caller already knows
 * whose events these are and ignores it, and one query shape is cheaper to
 * keep honest than two.
 */
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
      // Duration: how long it lives (from the form) and, once live, the moment
      // it actually expires. The calendar draws an event across the days it
      // covers from these.
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

/**
 * One run with its logs and accounts, or null if the viewer may not see it.
 * A manager and above may open anyone's; everyone else only their own.
 */
export async function getRunForViewer(runId: string, viewer: Viewer) {
  const run = await db.query.workshopRuns.findFirst({
    where: and(eq(workshopRuns.id, runId), ownedBy(viewer)),
  });
  if (!run) return null;

  const [logs, accounts, owner] = await Promise.all([
    db.query.runLogs.findMany({
      where: eq(runLogs.runId, runId),
      orderBy: runLogs.id,
    }),
    db.query.workshopAccounts.findMany({
      where: eq(workshopAccounts.runId, runId),
      orderBy: workshopAccounts.id,
    }),
    db.query.users.findFirst({
      where: eq(users.id, run.userId),
      columns: { id: true, name: true, email: true },
    }),
  ]);
  return { run, logs, accounts, owner: owner ?? null };
}

export type DeleteRunError = "not_found" | "in_flight";

/**
 * What deleting a run actually did.
 *
 * `deleted` — the row and everything hanging off it are gone.
 * `teardown_requested` — the run still owns Workspace accounts and cloud
 *   projects, so it can't simply be dropped: deleting the row would strand
 *   them with nothing left to say they exist. It is instead expired on the
 *   spot and flagged, and the reaper removes it once teardown finishes.
 */
export type DeleteRunOutcome = "deleted" | "teardown_requested";

/** Statuses where the runner is mid-flight and teardown would race it. */
const IN_FLIGHT = new Set(["requested", "provisioning", "applying"]);

/** Statuses where nothing was ever built, or it has already been torn down. */
const NOTHING_TO_TEAR_DOWN = new Set(["scheduled", "destroyed"]);

/**
 * Delete a run. The owner may delete their own; a manager and above may delete
 * anyone's. See `DeleteRunOutcome` for why this isn't always a `delete`.
 */
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
    // Accounts and logs go with it — both cascade on the run id.
    await db.delete(workshopRuns).where(eq(workshopRuns.id, runId));
    return { ok: true, outcome: "deleted" };
  }

  // `ready`, `failed`, or already `destroying`. The flag alone is what the
  // reaper keys on for a delete — it does not depend on `expires_at`, so we
  // leave the real end time untouched rather than shoving it to "now" (which
  // used to conflate "deleted" with "expired"). The reaper tears it down on its
  // next tick and removes the row once teardown finishes.
  await db
    .update(workshopRuns)
    .set({ deleteRequested: true })
    .where(eq(workshopRuns.id, runId));

  await db.insert(runLogs).values({
    runId,
    stream: "system",
    message:
      "Deletion requested — tearing down accounts, org unit, and cloud " +
      "resources first. This event disappears once that finishes.",
  });

  return { ok: true, outcome: "teardown_requested" };
}

/** Runs a user still owns; used to warn before their role is taken away. */
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

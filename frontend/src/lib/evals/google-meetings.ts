/**
 * eVals Settings → Google Meetings: the meetings, a page at a time, saving
 * and changing them, and the Google account their invites go out from.
 * Saving a meeting touches nothing outside the app; `google-meetings-sync.ts`
 * creates and updates the invites when Sync Now is pressed.
 */

import "server-only";

import { and, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  GOOGLE_CONNECTION_KEY,
  GOOGLE_MEETING_LIMITS,
  googleConnections,
  googleMeetings,
  MEETING_GROUPS,
  users,
  type GoogleMeeting,
  type MeetingGroup,
} from "@/db/schema";
import { currentCohortSummary } from "@/lib/evals/current-cohort";
import { MEETING_GROUP_COHORT, meetingStatus, orderedGroups, type MeetingStatus } from "@/lib/evals/google-meetings-plan";
import type { GoogleMeetingSort } from "@/lib/list-specs";
import { PAGE_SIZE, pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { zoomCredentials } from "@/lib/zoom";

/** A sync still marked running after this was cut off, and another may start. */
export const SYNC_STALE_MS = 10 * 60_000;

/* ------------------------------------------------------------------ */
/* The meetings                                                        */
/* ------------------------------------------------------------------ */

export const MEETING_WHEN = ["upcoming", "past"] as const;
export type MeetingWhen = (typeof MEETING_WHEN)[number];

export function isMeetingWhen(value: unknown): value is MeetingWhen {
  return MEETING_WHEN.includes(value as MeetingWhen);
}

export type GoogleMeetingRow = {
  id: string;
  title: string;
  startsAt: Date;
  durationMinutes: number;
  groups: MeetingGroup[];
  zoomJoinUrl: string | null;
  status: MeetingStatus;
  syncError: string | null;
  syncedAt: Date | null;
  /** How many guests the last sync put on the invite. */
  invited: number;
  addedBy: string | null;
};

const m = googleMeetings;

const endsAt = sql`(${m.startsAt} + make_interval(mins => ${m.durationMinutes}))`;

/** Upcoming until it ends, so a meeting under way is still listed with those to come. */
const WHEN: Record<MeetingWhen, ReturnType<typeof gt>> = {
  upcoming: gt(endsAt, sql`now()`),
  past: lte(endsAt, sql`now()`),
};

const SORT_COLUMNS = {
  startsAt: m.startsAt,
  title: sql`lower(${m.title})`,
  durationMinutes: m.durationMinutes,
} as const;

/** One page of meetings that are still to end, or that have; the search matches the title. */
export async function listGoogleMeetings(when: MeetingWhen, query: ListQuery<GoogleMeetingSort>): Promise<Page<GoogleMeetingRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: m.id,
      title: m.title,
      startsAt: m.startsAt,
      durationMinutes: m.durationMinutes,
      groups: m.groups,
      zoomJoinUrl: m.zoomJoinUrl,
      googleEventId: m.googleEventId,
      changedAt: m.changedAt,
      syncedAt: m.syncedAt,
      syncError: m.syncError,
      invited: sql<number>`cardinality(${m.invitedEmails})`,
      addedByName: users.name,
      addedByEmail: users.email,
    })
    .from(m)
    .leftJoin(users, eq(users.id, m.createdBy))
    .where(and(WHEN[when], searchAny(query.q, [m.title])))
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, m.startsAt, m.id))
    .limit(limit)
    .offset(offset);

  return toPage(
    rows.map(({ addedByName, addedByEmail, googleEventId, changedAt, ...row }) => ({
      ...row,
      groups: orderedGroups(row.groups),
      status: meetingStatus({ googleEventId, syncError: row.syncError, changedAt, syncedAt: row.syncedAt }),
      addedBy: addedByName ?? addedByEmail,
    })),
    query.page,
  );
}

/** How many meetings are still to end, and how many have. */
export async function googleMeetingCounts(): Promise<Record<MeetingWhen, number>> {
  const [row] = await db
    .select({
      upcoming: sql<number>`count(*) filter (where ${WHEN.upcoming})::int`,
      past: sql<number>`count(*) filter (where ${WHEN.past})::int`,
    })
    .from(m);
  return { upcoming: row?.upcoming ?? 0, past: row?.past ?? 0 };
}

/** Up to a page of the meetings still to end, soonest first, after `after`; the sync walks them with it. */
export async function upcomingMeetingsAfter(after: { startsAt: Date; id: string } | null): Promise<GoogleMeeting[]> {
  return db
    .select()
    .from(m)
    .where(
      and(
        WHEN.upcoming,
        after ? sql`(${m.startsAt}, ${m.id}) > (${after.startsAt.toISOString()}::timestamptz, ${after.id}::uuid)` : undefined,
      ),
    )
    .orderBy(m.startsAt, m.id)
    .limit(PAGE_SIZE);
}

export async function googleMeeting(id: string): Promise<GoogleMeeting | null> {
  const [row] = await db.select().from(m).where(eq(m.id, id));
  return row ?? null;
}

export type GoogleMeetingError =
  | "invalid"
  | "in_past"
  | "not_found"
  | "not_connected"
  | "remote_failed";

export const STATUS_FOR: Record<GoogleMeetingError, number> = {
  invalid: 400,
  in_past: 400,
  not_found: 404,
  not_connected: 409,
  remote_failed: 502,
};

export const meetingInputSchema = z.object({
  title: z.string().trim().min(1).max(GOOGLE_MEETING_LIMITS.title),
  /** ISO 8601 with an offset; the form sends the browser's local time as UTC. */
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  groups: z.array(z.enum(MEETING_GROUPS)).max(MEETING_GROUPS.length).default([]),
});

export type MeetingInput = z.infer<typeof meetingInputSchema>;

export const meetingPatchSchema = meetingInputSchema.partial();

export async function createGoogleMeeting(
  actorId: string,
  input: MeetingInput,
): Promise<{ ok: true; meeting: { id: string; title: string } } | { ok: false; error: GoogleMeetingError }> {
  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() < Date.now()) return { ok: false, error: "in_past" };

  const [row] = await db
    .insert(m)
    .values({
      title: input.title,
      startsAt,
      durationMinutes: input.durationMinutes,
      groups: orderedGroups(input.groups),
      createdBy: actorId,
    })
    .returning({ id: m.id, title: m.title });
  return { ok: true, meeting: row! };
}

/** Changes what was given. Moving a meeting into the past is refused; one already past can still be renamed. */
export async function updateGoogleMeeting(
  id: string,
  patch: z.infer<typeof meetingPatchSchema>,
): Promise<{ ok: true; meeting: { id: string; title: string } } | { ok: false; error: GoogleMeetingError }> {
  const current = await googleMeeting(id);
  if (!current) return { ok: false, error: "not_found" };

  const startsAt = patch.startsAt === undefined ? current.startsAt : new Date(patch.startsAt);
  if (startsAt.getTime() !== current.startsAt.getTime() && startsAt.getTime() < Date.now()) {
    return { ok: false, error: "in_past" };
  }
  const next = {
    title: patch.title ?? current.title,
    startsAt,
    durationMinutes: patch.durationMinutes ?? current.durationMinutes,
    groups: patch.groups === undefined ? current.groups : orderedGroups(patch.groups),
  };
  const changed =
    next.title !== current.title ||
    next.startsAt.getTime() !== current.startsAt.getTime() ||
    next.durationMinutes !== current.durationMinutes ||
    next.groups.join() !== orderedGroups(current.groups).join();
  if (!changed) return { ok: true, meeting: { id, title: current.title } };

  const [row] = await db
    .update(m)
    .set({ ...next, changedAt: new Date() })
    .where(eq(m.id, id))
    .returning({ id: m.id, title: m.title });
  return row ? { ok: true, meeting: row } : { ok: false, error: "not_found" };
}

export async function removeGoogleMeetingRow(id: string): Promise<boolean> {
  const deleted = await db.delete(m).where(eq(m.id, id)).returning({ id: m.id });
  return deleted.length > 0;
}

/** Records what a sync made for one meeting. */
export async function recordMeetingSync(
  id: string,
  result:
    | { ok: true; syncedAt: Date; googleEventId: string; invitedEmails: string[]; zoomMeetingId: string | null; zoomJoinUrl: string | null }
    | { ok: false; error: string; zoomMeetingId: string | null; zoomJoinUrl: string | null },
): Promise<void> {
  await db
    .update(m)
    .set(
      result.ok
        ? {
            googleEventId: result.googleEventId,
            invitedEmails: result.invitedEmails,
            zoomMeetingId: result.zoomMeetingId,
            zoomJoinUrl: result.zoomJoinUrl,
            syncedAt: result.syncedAt,
            syncError: null,
          }
        : { zoomMeetingId: result.zoomMeetingId, zoomJoinUrl: result.zoomJoinUrl, syncError: result.error.slice(0, 1_000) },
    )
    .where(eq(m.id, id));
}

/* ------------------------------------------------------------------ */
/* Who is on every invite                                              */
/* ------------------------------------------------------------------ */

/**
 * Everyone who holds the Assessments Administrator role, lowercased. A
 * platform administrator counts as one inside the app, but is not invited
 * unless they hold the role too: these are the people who run the meetings.
 */
export async function assessmentAdministratorEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: sql<string>`lower(${users.email})` })
    .from(users)
    .where(and(eq(users.assessmentsRole, "administrator"), isNotNull(users.email)))
    .orderBy(sql`lower(${users.email})`)
    .limit(PAGE_SIZE);
  return rows.map((r) => r.email);
}

/* ------------------------------------------------------------------ */
/* The connected Google account                                        */
/* ------------------------------------------------------------------ */

const c = googleConnections;

export type GoogleConnection = typeof googleConnections.$inferSelect;

export async function googleConnection(): Promise<GoogleConnection | null> {
  const [row] = await db.select().from(c).where(eq(c.key, GOOGLE_CONNECTION_KEY));
  return row ?? null;
}

/** The connection as the page and the API show it: never the token. */
export type GoogleConnectionStatus = {
  email: string;
  connectedAt: Date;
  connectedBy: string | null;
  calendarId: string | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  running: boolean;
};

export async function googleConnectionStatus(): Promise<GoogleConnectionStatus | null> {
  const [row] = await db
    .select({
      email: c.email,
      connectedAt: c.connectedAt,
      connectedByName: users.name,
      connectedByEmail: users.email,
      calendarId: c.calendarId,
      lastSyncAt: c.lastSyncAt,
      lastSyncError: c.lastSyncError,
      syncStartedAt: c.syncStartedAt,
    })
    .from(c)
    .leftJoin(users, eq(users.id, c.connectedBy))
    .where(eq(c.key, GOOGLE_CONNECTION_KEY));
  if (!row) return null;
  const { connectedByName, connectedByEmail, syncStartedAt, ...rest } = row;
  return {
    ...rest,
    connectedBy: connectedByName ?? connectedByEmail,
    running: syncStartedAt !== null && Date.now() - syncStartedAt.getTime() < SYNC_STALE_MS,
  };
}

/**
 * Stores the account the consent screen returned. Reconnecting the same
 * account only replaces its token. A different account is refused while any
 * meeting has an invite: those invites live on the first account's calendar,
 * and the new one could neither update nor cancel them.
 */
export async function saveGoogleConnection(
  actorId: string,
  account: { email: string; refreshToken: Buffer; scope: string },
): Promise<{ ok: true; replaced: boolean } | { ok: false; error: "different_account"; current: string }> {
  const current = await googleConnection();
  if (current && current.email !== account.email) {
    const [synced] = await db.select({ id: m.id }).from(m).where(isNotNull(m.googleEventId)).limit(1);
    if (synced) return { ok: false, error: "different_account", current: current.email };
  }
  const sameAccount = current?.email === account.email;
  await db
    .insert(c)
    .values({ key: GOOGLE_CONNECTION_KEY, ...account, connectedBy: actorId })
    .onConflictDoUpdate({
      target: c.key,
      set: {
        ...account,
        connectedBy: actorId,
        connectedAt: new Date(),
        lastSyncError: null,
        // A new account starts its own calendar, shared with nobody yet.
        ...(sameAccount ? {} : { calendarId: null, sharedWith: [] }),
      },
    });
  return { ok: true, replaced: current !== null };
}

/** Marks a sync as running, unless one already is; false when one is. */
export async function claimGoogleSync(): Promise<boolean> {
  const claimed = await db
    .update(c)
    .set({ syncStartedAt: new Date() })
    .where(
      and(
        eq(c.key, GOOGLE_CONNECTION_KEY),
        sql`(${c.syncStartedAt} is null or ${c.syncStartedAt} < now() - make_interval(secs => ${SYNC_STALE_MS / 1_000}))`,
      ),
    )
    .returning({ key: c.key });
  return claimed.length > 0;
}

export async function finishGoogleSync(result: {
  calendarId?: string;
  sharedWith?: string[];
  error: string | null;
}): Promise<void> {
  await db
    .update(c)
    .set({
      syncStartedAt: null,
      lastSyncAt: new Date(),
      lastSyncError: result.error?.slice(0, 1_000) ?? null,
      ...(result.calendarId ? { calendarId: result.calendarId } : {}),
      ...(result.sharedWith ? { sharedWith: result.sharedWith } : {}),
    })
    .where(eq(c.key, GOOGLE_CONNECTION_KEY));
}

/* ------------------------------------------------------------------ */
/* The tab as a whole                                                  */
/* ------------------------------------------------------------------ */

export type GoogleMeetingsOverview = {
  connection: GoogleConnectionStatus | null;
  /** Whether Sync Now can make Zoom meetings. */
  zoomConfigured: boolean;
  /** Guests on every invite, with edit access to the meetings calendar. */
  administrators: string[];
  counts: Record<MeetingWhen, number>;
  /** How many on the Current tab each group would invite now. */
  groupSizes: Record<MeetingGroup, number>;
};

export async function googleMeetingsOverview(): Promise<GoogleMeetingsOverview> {
  const [connection, administrators, counts, cohort] = await Promise.all([
    googleConnectionStatus(),
    assessmentAdministratorEmails(),
    googleMeetingCounts(),
    currentCohortSummary(),
  ]);
  const groupSizes = Object.fromEntries(
    MEETING_GROUPS.map((g) => [g, cohort.counts[MEETING_GROUP_COHORT[g].stage][MEETING_GROUP_COHORT[g].track]]),
  ) as Record<MeetingGroup, number>;
  return { connection, zoomConfigured: zoomCredentials() !== null, administrators, counts, groupSizes };
}

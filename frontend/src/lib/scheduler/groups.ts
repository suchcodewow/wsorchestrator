/**
 * Breakout groups: in a breakout, each attendee goes with one of its
 * instructors to that instructor's room, to be evaluated there with the rest
 * of their group. Who can be in one is in `attendees.ts`. Someone already in
 * a group stays in it after leaving the class, as an instructor stays on a
 * session after leaving the pool, so a past bootcamp's groups survive the
 * next sync.
 */

import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { EVALS_SLACK_CONTACT_LIMITS, SCHEDULE_LIMITS, scheduleSessionGroups } from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import { normalEmail } from "@/lib/evals/history-values";
import { classAttendees } from "@/lib/scheduler/attendees";
import { getSession } from "@/lib/scheduler/schedule";

export type { GroupAttendee } from "@/lib/scheduler/attendees";

export type GroupRow = {
  email: string;
  fullName: string;
  /** One of the session's staff. */
  instructorEmail: string;
  /** Their `employees.track` now; null when HiBob no longer lists them. */
  track: string | null;
};

/** A session's groups, each instructor's people in the order they were put there. */
export async function groupsOf(sessionId: string): Promise<GroupRow[]> {
  return db
    .select({
      email: scheduleSessionGroups.email,
      fullName: scheduleSessionGroups.fullName,
      instructorEmail: scheduleSessionGroups.instructorEmail,
      // Spelled out: in a one-table select drizzle leaves columns unqualified, and the inner email would be the employee's.
      track: sql<string | null>`(select hr.track from employees hr where hr.email = schedule_session_groups.email limit 1)`,
    })
    .from(scheduleSessionGroups)
    .where(eq(scheduleSessionGroups.sessionId, sessionId))
    .orderBy(asc(scheduleSessionGroups.position), asc(scheduleSessionGroups.email))
    .limit(SCHEDULE_LIMITS.groupPeople);
}

const email = z.string().max(EVALS_SLACK_CONTACT_LIMITS.email);

export const groupsInputSchema = z.object({
  /** Every attendee assigned, and whose group they are in; anyone left out is not assigned. */
  groups: z.array(z.object({ email, instructorEmail: email })).max(SCHEDULE_LIMITS.groupPeople),
});

export type GroupsError = "invalid" | "not_found" | "not_breakout" | "not_staff" | "not_attendee";

export const GROUPS_STATUS_FOR: Record<GroupsError, number> = {
  invalid: 400,
  not_found: 404,
  not_breakout: 409,
  not_staff: 400,
  not_attendee: 400,
};

/**
 * Replaces a breakout's groups. Each instructor named must be on its staff,
 * and each attendee one it is taught to or already in one of its groups; an
 * attendee named twice is refused as `invalid`.
 */
export async function saveGroups(
  bootcampId: string,
  sessionId: string,
  input: z.infer<typeof groupsInputSchema>,
): Promise<{ ok: true; groups: GroupRow[] } | { ok: false; error: GroupsError; email?: string }> {
  const session = await getSession(bootcampId, sessionId);
  if (!session) return { ok: false, error: "not_found" };
  noteAudit({ target: sessionId, targetLabel: `Breakout groups of ${session.name}` });
  if (session.kind !== "breakout") return { ok: false, error: "not_breakout" };

  const staff = new Set(session.staff.map((s) => s.email));
  const rows: { email: string; instructorEmail: string }[] = [];
  const seen = new Set<string>();
  for (const g of input.groups) {
    const who = normalEmail(g.email);
    const instructor = normalEmail(g.instructorEmail);
    if (!who || !instructor || seen.has(who)) return { ok: false, error: "invalid" };
    seen.add(who);
    if (!staff.has(instructor)) return { ok: false, error: "not_staff", email: instructor };
    rows.push({ email: who, instructorEmail: instructor });
  }

  const [{ attendees }, before] = await Promise.all([classAttendees(session.track, session.audience), groupsOf(sessionId)]);
  const names = new Map([...before.map((g) => [g.email, g.fullName] as const), ...attendees.map((a) => [a.email, a.fullName] as const)]);
  const outsider = rows.find((r) => !names.has(r.email));
  if (outsider) return { ok: false, error: "not_attendee", email: outsider.email };

  await db.transaction(async (tx) => {
    await tx.delete(scheduleSessionGroups).where(eq(scheduleSessionGroups.sessionId, sessionId));
    if (rows.length === 0) return;
    await tx
      .insert(scheduleSessionGroups)
      .values(rows.map((r, position) => ({ sessionId, ...r, fullName: names.get(r.email) ?? "", position })));
  });
  return { ok: true, groups: await groupsOf(sessionId) };
}


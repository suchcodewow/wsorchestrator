/**
 * The Diagnostic's Participants: the only people who can take its tests,
 * whatever their roles. Someone is one when an Assessments Administrator adds
 * them by hand on Diagnostic Settings, or, while Bootcamp Auto-Enroll is on,
 * when they are a bootcamp candidate on the Sales or Engineer track who has
 * RSVP'd (`rsvpedForBootcamp`).
 *
 * Only the hand-added are stored. The auto-enrolled are worked out on each
 * read, so someone who RSVPs is enrolled at once, and stopping auto-enroll
 * removes every one of them while leaving the hand-added, who override it.
 * Participants are not the Training cohort: anyone at Harness can be added.
 */

import "server-only";
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { IRIS_SETTINGS_KEYS, employees, irisAttempts, irisParticipants, irisSettings, irisTakers, users } from "@/db/schema";
import { rsvpedForBootcamp } from "@/lib/evals/current-cohort";
import { getCandidateCutoffs } from "@/lib/evals/settings";
import type { Form, Level } from "@/lib/iris/engine";
import { compositeOf, isSubjectKey, type SubjectKey, type Track } from "@/lib/iris/subjects";
import type { IrisParticipantSort, IrisRecordSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

export type AutoEnroll = {
  on: boolean;
  /** When it was last turned on or off, and by whom; null before it ever was. */
  changedAt: Date | null;
  changedBy: string | null;
};

const AUTO_ENROLL = IRIS_SETTINGS_KEYS.bootcampAutoEnroll;

export async function getAutoEnroll(): Promise<AutoEnroll> {
  const [row] = await db
    .select({
      value: irisSettings.value,
      changedAt: irisSettings.updatedAt,
      changedBy: sql<string | null>`(select coalesce(nullif(u.name, ''), u.email) from ${users} u where u.id = ${irisSettings.updatedBy})`,
    })
    .from(irisSettings)
    .where(eq(irisSettings.key, AUTO_ENROLL));
  return { on: row?.value === "true", changedAt: row?.changedAt ?? null, changedBy: row?.changedBy ?? null };
}

export async function setAutoEnroll(actorId: string, on: boolean): Promise<AutoEnroll> {
  const value = on ? "true" : "false";
  await db
    .insert(irisSettings)
    .values({ key: AUTO_ENROLL, value, updatedBy: actorId })
    .onConflictDoUpdate({ target: irisSettings.key, set: { value, updatedBy: actorId, updatedAt: new Date() } });
  return getAutoEnroll();
}

/**
 * Whether `email` is a Participant now. Read on every request that builds an
 * `Access`, like judging, so stopping auto-enroll or removing someone takes
 * effect on their next click. One query for most people; two more only while
 * auto-enroll is on and they were not added by hand.
 */
export async function isParticipantNow(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const lower = email.toLowerCase();
  const { rows } = await db.execute<{ manual: boolean; auto: boolean }>(sql`
    select exists (select 1 from ${irisParticipants} where ${irisParticipants.email} = ${lower}) as manual,
           coalesce((select ${irisSettings.value} = 'true' from ${irisSettings} where ${irisSettings.key} = ${AUTO_ENROLL}), false) as auto`);
  const { manual, auto } = rows[0] ?? { manual: false, auto: false };
  if (manual) return true;
  if (!auto) return false;
  const [row] = await db
    .select({ email: employees.email })
    .from(employees)
    .where(sql`${employees.email} = ${lower} and ${rsvpedForBootcamp(await getCandidateCutoffs())}`)
    .limit(1);
  return Boolean(row);
}

/**
 * Every Participant as rows of (email, manual, added_at, added_by, track): the
 * hand-added, then, while auto-enroll is on, the auto-enrolled not also
 * added by hand.
 */
async function participantsSql(): Promise<SQL> {
  const manual = sql`select ${irisParticipants.email} as email, true as manual, ${irisParticipants.addedAt} as added_at, ${irisParticipants.addedBy} as added_by, ${irisParticipants.track} as track from ${irisParticipants}`;
  if (!(await getAutoEnroll()).on) return manual;
  return sql`${manual}
    union all
    select distinct lower(${employees.email}), false, null::timestamptz, null::text, null::text
      from ${employees}
     where ${rsvpedForBootcamp(await getCandidateCutoffs())}
       and not exists (select 1 from ${irisParticipants} where ${irisParticipants.email} = lower(${employees.email}))`;
}

/** The lowercased emails of every Participant, as a subquery for `in (…)`. */
export async function participantEmails(): Promise<SQL> {
  return sql`select p.email from (${await participantsSql()}) p`;
}

export type ParticipantRow = {
  email: string;
  name: string | null;
  /** Their account; null for someone who has not signed in yet. */
  userId: string | null;
  /** Added by hand, which outlasts auto-enroll; false for the auto-enrolled. */
  manual: boolean;
  addedAt: Date | null;
  addedBy: string | null;
  track: Track | null;
  placements: Partial<Record<SubjectKey, Level>>;
  completed: number;
  composite: number | null;
  /** When they last finished a subject; null before their first. */
  finishedAt: Date | null;
};

type RawRow = Omit<ParticipantRow, "placements" | "composite" | "finishedAt" | "addedAt"> & {
  placements: Record<string, number> | null;
  finishedAt: string | Date | null;
  addedAt: string | Date | null;
};

const SORT_COLUMNS: Record<IrisParticipantSort, SQL> = {
  person: sql`lower(coalesce(nullif(u.name, ''), emp.full_name, p.email))`,
  track: sql`coalesce(t.track, p.track)`,
  completed: sql`coalesce(r.completed, 0)`,
  finishedAt: sql`r.finished_at`,
  added: sql`(case when p.manual then 0 else 1 end)`,
};

/** One page of the Participants, with their placements on `form`, searched by name or email. */
export async function listParticipants(query: ListQuery<IrisParticipantSort>, form: Form): Promise<Page<ParticipantRow>> {
  const { limit, offset } = pageWindow(query.page);
  const where = sql`${searchAny(query.q, [sql`u.name`, sql`emp.full_name`, sql`p.email`]) ?? sql`true`}`;
  const order = orderFor(SORT_COLUMNS[query.sort], query.dir, sql`p.email`);
  const { rows } = await db.execute<RawRow>(sql`
    select p.email, coalesce(nullif(u.name, ''), emp.full_name) as name, u.id as "userId", p.manual,
           p.added_at as "addedAt",
           (select coalesce(nullif(a.name, ''), a.email) from ${users} a where a.id = p.added_by) as "addedBy",
           coalesce(t.track, p.track) as track, coalesce(r.completed, 0)::int as completed, r.finished_at as "finishedAt", r.placements
      from (${await participantsSql()}) p
      left join ${users} u on lower(u.email) = p.email
      left join lateral (
        select e.full_name from ${employees} e where e.email = p.email order by e.active desc limit 1
      ) emp on true
      left join ${irisTakers} t on t.user_id = u.id
      left join lateral (
        select count(*) as completed, max(${irisAttempts.finishedAt}) as finished_at,
               json_object_agg(${irisAttempts.subject}, ${irisAttempts.placement}) as placements
          from ${irisAttempts}
         where ${irisAttempts.userId} = u.id and ${irisAttempts.mode} = 'live'
           and ${irisAttempts.form} = ${form} and ${irisAttempts.finishedAt} is not null
      ) r on true
     where ${where}
     order by ${sql.join(order, sql`, `)}
     limit ${limit} offset ${offset}`);

  return toPage(rows.map(toParticipantRow), query.page);
}

function toParticipantRow(r: RawRow): ParticipantRow {
  const placements = placementsOf(r.placements);
  const track = (r.track as Track | null) ?? null;
  return {
    email: r.email,
    name: r.name,
    userId: r.userId,
    manual: r.manual,
    addedAt: r.addedAt ? new Date(r.addedAt) : null,
    addedBy: r.addedBy,
    track,
    placements,
    completed: Number(r.completed),
    composite: track ? compositeOf(placements, track) : null,
    finishedAt: r.finishedAt ? new Date(r.finishedAt) : null,
  };
}

/** A Record: someone with a sitting, and whether they are a Participant now. */
export type RecordRow = ParticipantRow & { userId: string; enrolled: boolean };

const RECORD_SORT_COLUMNS: Record<IrisRecordSort, SQL> = {
  person: sql`lower(coalesce(nullif(u.name, ''), emp.full_name, u.email))`,
  track: sql`coalesce(t.track, p.track)`,
  completed: sql`coalesce(r.completed, 0)`,
  finishedAt: sql`r.finished_at`,
  added: sql`(case when p.manual then 0 when p.email is not null then 1 else 2 end)`,
};

/** Everyone with a live sitting on `form`, as a subquery of user ids. */
const takersOn = (form: Form) =>
  sql`select distinct ${irisAttempts.userId} from ${irisAttempts} where ${irisAttempts.mode} = 'live' and ${irisAttempts.form} = ${form}`;

/**
 * One page of the Records: everyone with a live sitting on `form`, finished
 * or not, whether they are still a Participant or not, searched by name or email.
 */
export async function listRecords(query: ListQuery<IrisRecordSort>, form: Form): Promise<Page<RecordRow>> {
  const { limit, offset } = pageWindow(query.page);
  const where = sql`${searchAny(query.q, [sql`u.name`, sql`emp.full_name`, sql`u.email`]) ?? sql`true`}`;
  const order = orderFor(RECORD_SORT_COLUMNS[query.sort], query.dir, sql`u.id`);
  const { rows } = await db.execute<RawRow & { userId: string; enrolled: boolean }>(sql`
    select lower(u.email) as email, coalesce(nullif(u.name, ''), emp.full_name) as name, u.id as "userId",
           coalesce(p.manual, false) as manual, p.email is not null as enrolled, p.added_at as "addedAt",
           (select coalesce(nullif(a.name, ''), a.email) from ${users} a where a.id = p.added_by) as "addedBy",
           coalesce(t.track, p.track) as track, coalesce(r.completed, 0)::int as completed, r.finished_at as "finishedAt", r.placements
      from ${users} u
      left join (${await participantsSql()}) p on p.email = lower(u.email)
      left join lateral (
        select e.full_name from ${employees} e where e.email = lower(u.email) order by e.active desc limit 1
      ) emp on true
      left join ${irisTakers} t on t.user_id = u.id
      left join lateral (
        select count(*) as completed, max(${irisAttempts.finishedAt}) as finished_at,
               json_object_agg(${irisAttempts.subject}, ${irisAttempts.placement}) as placements
          from ${irisAttempts}
         where ${irisAttempts.userId} = u.id and ${irisAttempts.mode} = 'live'
           and ${irisAttempts.form} = ${form} and ${irisAttempts.finishedAt} is not null
      ) r on true
     where u.id in (${takersOn(form)}) and ${where}
     order by ${sql.join(order, sql`, `)}
     limit ${limit} offset ${offset}`);

  return toPage(
    rows.map((r) => ({ ...toParticipantRow(r), userId: r.userId, enrolled: r.enrolled })),
    query.page,
  );
}

/** How many people have a Record on `form`, whatever the search. */
export async function recordCount(form: Form): Promise<number> {
  const { rows } = await db.execute<{ total: number }>(sql`select count(*)::int as total from (${takersOn(form)}) t`);
  return rows[0]?.total ?? 0;
}

export type ParticipantCounts = { total: number; manual: number; auto: number };

/** How many Participants there are, added by hand and auto-enrolled, whatever the search. */
export async function participantCounts(): Promise<ParticipantCounts> {
  const { rows } = await db.execute<{ total: number; manual: number }>(sql`
    select count(*)::int as total, (count(*) filter (where p.manual))::int as manual from (${await participantsSql()}) p`);
  const total = rows[0]?.total ?? 0;
  const manual = rows[0]?.manual ?? 0;
  return { total, manual, auto: total - manual };
}

function placementsOf(raw: Record<string, number> | null): Partial<Record<SubjectKey, Level>> {
  const out: Partial<Record<SubjectKey, Level>> = {};
  for (const [k, v] of Object.entries(raw ?? {})) if (isSubjectKey(k) && v) out[k] = v as Level;
  return out;
}

/**
 * - `unknown_person` — nobody by that email is on the employee list from HiBob or has an account here.
 * - `duplicate`      — they were already added by hand.
 */
export type AddParticipantError = "unknown_person" | "duplicate";

export const ADD_PARTICIPANT_STATUS: Record<AddParticipantError, number> = { unknown_person: 400, duplicate: 409 };

/**
 * Adds someone by hand, which keeps them a Participant whether auto-enroll is
 * on or not: an employee, or an account already here, such as a test account.
 * A `track` is theirs at once if they have an account, replacing any they
 * chose, and otherwise waits on their row for when they first sign in; null
 * leaves it to them.
 */
export async function addParticipant(
  actorId: string,
  email: string,
  track: Track | null = null,
): Promise<{ ok: true; email: string; fullName: string } | { ok: false; error: AddParticipantError }> {
  const lower = email.trim().toLowerCase();
  const [employee] = await db
    .select({ fullName: employees.fullName })
    .from(employees)
    .where(eq(employees.email, lower))
    .orderBy(sql`${employees.active} desc`)
    .limit(1);
  const [account] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(sql`lower(${users.email}) = ${lower}`)
    .limit(1);
  if (!employee && !account) return { ok: false, error: "unknown_person" };
  const [added] = await db
    .insert(irisParticipants)
    .values({ email: lower, addedBy: actorId, track })
    .onConflictDoNothing()
    .returning({ email: irisParticipants.email });
  if (!added) return { ok: false, error: "duplicate" };
  if (track && account) {
    await db
      .insert(irisTakers)
      .values({ userId: account.id, track, updatedAt: new Date() })
      .onConflictDoUpdate({ target: irisTakers.userId, set: { track, updatedAt: new Date() } });
  }
  return { ok: true, email: lower, fullName: employee?.fullName ?? account?.name ?? "" };
}

/**
 * Takes away the hand-added override. Someone auto-enroll still counts stays
 * a Participant through it; anyone else can no longer start a test. Their
 * results are kept.
 */
export async function removeParticipant(email: string): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const gone = await db
    .delete(irisParticipants)
    .where(eq(irisParticipants.email, email.trim().toLowerCase()))
    .returning({ email: irisParticipants.email });
  return gone.length ? { ok: true } : { ok: false, error: "not_found" };
}

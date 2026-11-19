/**
 * The Bootcamp superlatives survey: the standing list of superlatives, edited
 * on Logistics settings; sending it from a Bootcamp's schedule to the whole
 * class, Sales and Engineers together; each person voting a classmate for
 * each superlative at /intake; and the votes counted on Survey Results.
 *
 * A Bootcamp has at most one. Sending it copies the list and the class in,
 * so editing the list later, or the class changing, does not move a ballot
 * already out. It can be unassigned, which hides it from the class but keeps
 * every vote; sending it again brings it back with the list and the class as
 * they now stand, and keeps each vote that still fits.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  bootcamps,
  superlativeAssignments,
  superlativeLists,
  superlativeSurveys,
  type Superlative,
  type SuperlativeNominee,
  type SuperlativeVotes,
} from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import { PAGE_SIZE } from "@/lib/paging";
import { superlativeAttendees } from "@/lib/scheduler/attendees";
import {
  ballotFor,
  checkSuperlativeVotes,
  keptVotes,
  superlativeListFrom,
  type SuperlativeListInput,
  type SuperlativeStanding,
  type SuperlativeStatus,
  type SuperlativeSubmission,
  type SuperlativeVoteProblem,
} from "@/lib/surveys/superlative-values";
import { surveyMonth } from "@/lib/surveys/survey-values";

const s = superlativeSurveys;
const a = superlativeAssignments;

const LIST_ID = "bootcamp";

/** The standing list, and when it was last saved; empty and null before anyone has. */
export async function getSuperlativeList(): Promise<{ superlatives: Superlative[]; updatedAt: string | null }> {
  const [row] = await db
    .select({ superlatives: superlativeLists.superlatives, updatedAt: superlativeLists.updatedAt })
    .from(superlativeLists)
    .where(eq(superlativeLists.id, LIST_ID));
  return { superlatives: row?.superlatives ?? [], updatedAt: row?.updatedAt.toISOString() ?? null };
}

/** Saves `input` as the standing list, in its order. A survey already sent keeps the list it was sent with. */
export async function saveSuperlativeList(
  actorId: string,
  input: SuperlativeListInput,
): Promise<{ superlatives: Superlative[]; updatedAt: string | null }> {
  const superlatives = superlativeListFrom(input, randomUUID);
  const now = new Date();
  await db
    .insert(superlativeLists)
    .values({ id: LIST_ID, superlatives, updatedBy: actorId, updatedAt: now })
    .onConflictDoUpdate({ target: superlativeLists.id, set: { superlatives, updatedBy: actorId, updatedAt: now } });
  noteAudit({ target: "superlatives", targetLabel: "Bootcamp superlatives", detail: { superlatives: superlatives.length } });
  return { superlatives, updatedAt: now.toISOString() };
}

/** Whether Bootcamp `bootcampId`'s superlatives are out, and how many have voted; null while they are not. */
export async function superlativeStatus(bootcampId: string): Promise<SuperlativeStatus | null> {
  const [row] = await db
    .select({
      assigned: sql<number>`count(${a.id})::int`,
      answered: sql<number>`count(${a.submittedAt})::int`,
    })
    .from(s)
    .leftJoin(a, eq(a.surveyId, s.id))
    .where(and(eq(s.bootcampId, bootcampId), isNull(s.unassignedAt)))
    .groupBy(s.id);
  return row ?? null;
}

export type SendSuperlativesError = "not_found" | "no_superlatives" | "no_class";

export const SEND_STATUS_FOR: Record<SendSuperlativesError, number> = { not_found: 404, no_superlatives: 409, no_class: 409 };

export type SentSuperlatives = {
  id: string;
  /** Whether this call made it, or brought it back, rather than finding it already out. */
  created: boolean;
  /** People sent it by this call; anyone who already had it is not counted. */
  sent: number;
  /** More of the class than one survey takes; those past the limit were not sent it. */
  hasMore: boolean;
  superlatives: number;
};

/**
 * Sends Bootcamp `bootcampId`'s superlatives survey to its class, asking the
 * standing list. One already out is reused with the list it was sent with,
 * and anyone who has joined the class since is sent it and can be voted for.
 * One that was unassigned is brought back with the list and the class as they
 * now stand: each vote for a superlative and classmate still on it is kept,
 * and someone missing a vote is asked again.
 */
export async function sendSuperlatives(
  actorId: string | null,
  bootcampId: string,
): Promise<{ ok: true; value: SentSuperlatives } | { ok: false; error: SendSuperlativesError }> {
  const [bootcamp] = await db.select({ startDate: bootcamps.startDate }).from(bootcamps).where(eq(bootcamps.id, bootcampId));
  if (!bootcamp) return { ok: false, error: "not_found" };
  const { superlatives } = await getSuperlativeList();
  if (superlatives.length === 0) return { ok: false, error: "no_superlatives" };
  const { attendees, hasMore } = await superlativeAttendees();
  if (attendees.length < 2) return { ok: false, error: "no_class" };
  const nominees: SuperlativeNominee[] = attendees.map((p) => ({ email: p.email.toLowerCase(), fullName: p.fullName }));

  const value = await db.transaction(async (tx) => {
    const fresh = await tx
      .insert(s)
      .values({ bootcampId, superlatives, nominees, createdBy: actorId })
      .onConflictDoNothing()
      .returning({ id: s.id });
    const [survey] = await tx
      .select({ id: s.id, superlatives: s.superlatives, nominees: s.nominees, unassignedAt: s.unassignedAt })
      .from(s)
      .where(eq(s.bootcampId, bootcampId));
    const revived = survey!.unassignedAt !== null;
    if (revived) {
      survey!.superlatives = superlatives;
      survey!.nominees = nominees;
      await tx.update(s).set({ superlatives, nominees, unassignedAt: null }).where(eq(s.id, survey!.id));
      await keepVotesThatFit(tx, survey!.id, superlatives, nominees);
    } else if (fresh.length === 0) {
      // Out already: whoever has joined the class since can be voted for too.
      const known = new Set(survey!.nominees.map((n) => n.email));
      const joined = nominees.filter((n) => !known.has(n.email));
      if (joined.length > 0) {
        survey!.nominees = [...survey!.nominees, ...joined];
        await tx.update(s).set({ nominees: survey!.nominees }).where(eq(s.id, survey!.id));
      }
    }
    const inserted = await tx
      .insert(a)
      .values(nominees.map((p) => ({ surveyId: survey!.id, email: p.email, fullName: p.fullName })))
      .onConflictDoNothing()
      .returning({ id: a.id });
    return {
      id: survey!.id,
      created: fresh.length > 0 || revived,
      sent: inserted.length,
      hasMore,
      superlatives: survey!.superlatives.length,
    };
  });

  noteAudit({
    target: bootcampId,
    targetLabel: `Superlatives: ${surveyMonth(bootcamp.startDate)} Bootcamp`,
    detail: { sent: value.sent, superlatives: value.superlatives },
  });
  return { ok: true, value };
}

/** Trims every answered copy of survey `surveyId` to the votes that fit `superlatives` and `nominees`. */
async function keepVotesThatFit(
  tx: Pick<typeof db, "select" | "update">,
  surveyId: string,
  superlatives: readonly Superlative[],
  nominees: readonly SuperlativeNominee[],
) {
  const voted = await tx.select({ id: a.id, votes: a.votes, submittedAt: a.submittedAt }).from(a).where(and(eq(a.surveyId, surveyId), isNotNull(a.votes)));
  for (const row of voted) {
    const { votes, complete } = keptVotes(row.votes ?? {}, superlatives, nominees);
    const empty = Object.keys(votes).length === 0;
    await tx
      .update(a)
      .set({ votes: empty ? null : votes, submittedAt: complete ? row.submittedAt : null })
      .where(eq(a.id, row.id));
  }
}

/** Takes Bootcamp `bootcampId`'s superlatives back from the class, keeping every vote; whether there were any out. */
export async function unassignSuperlatives(bootcampId: string): Promise<{ ok: true; value: { unassigned: number } } | { ok: false; error: "not_found" }> {
  const [bootcamp] = await db.select({ startDate: bootcamps.startDate }).from(bootcamps).where(eq(bootcamps.id, bootcampId));
  if (!bootcamp) return { ok: false, error: "not_found" };
  const rows = await db
    .update(s)
    .set({ unassignedAt: new Date() })
    .where(and(eq(s.bootcampId, bootcampId), isNull(s.unassignedAt)))
    .returning({ id: s.id });
  noteAudit({
    target: bootcampId,
    targetLabel: `Superlatives unassigned: ${surveyMonth(bootcamp.startDate)} Bootcamp`,
    detail: { unassigned: rows.length },
  });
  return { ok: true, value: { unassigned: rows.length } };
}

/** One of someone's superlatives surveys, as their list of forms shows it. */
export type MySuperlativesListing = { id: string; startDate: string; superlatives: number; assignedAt: string; submittedAt: string | null };

/** `email`'s superlatives surveys that are out, the unanswered first. */
export async function listMySuperlatives(email: string): Promise<MySuperlativesListing[]> {
  const rows = await db
    .select({
      id: a.id,
      startDate: bootcamps.startDate,
      superlatives: sql<number>`jsonb_array_length(${s.superlatives})::int`,
      assignedAt: a.assignedAt,
      submittedAt: a.submittedAt,
    })
    .from(a)
    .innerJoin(s, eq(s.id, a.surveyId))
    .innerJoin(bootcamps, eq(bootcamps.id, s.bootcampId))
    .where(and(eq(a.email, email.toLowerCase()), isNull(s.unassignedAt)))
    .orderBy(sql`${a.submittedAt} is not null`, desc(bootcamps.startDate))
    .limit(PAGE_SIZE);
  return rows.map((r) => ({ ...r, assignedAt: r.assignedAt.toISOString(), submittedAt: r.submittedAt?.toISOString() ?? null }));
}

/** Someone's own superlatives survey: what it asks, who they can vote for, and the votes they last saved. */
export type MySuperlatives = {
  id: string;
  startDate: string;
  superlatives: Superlative[];
  /** The class but themselves, by name. */
  ballot: SuperlativeNominee[];
  /** null until they have voted; may be short of a superlative when the survey was sent again with more. */
  votes: SuperlativeVotes | null;
  submittedAt: string | null;
};

/** The superlatives survey `id`, if it was sent to `email` and is out; null otherwise, so no one learns another's exists. */
export async function getMySuperlatives(email: string, id: string): Promise<MySuperlatives | null> {
  const mine = await loadMine(email, id);
  return mine && shown(mine);
}

/** Someone's own survey as they see it: the ballot, not the whole class. */
function shown(mine: MySuperlatives): MySuperlatives {
  return {
    id: mine.id,
    startDate: mine.startDate,
    superlatives: mine.superlatives,
    ballot: mine.ballot,
    votes: mine.votes,
    submittedAt: mine.submittedAt,
  };
}

/** `getMySuperlatives`, with the whole class its votes are checked against. */
async function loadMine(email: string, id: string): Promise<(MySuperlatives & { nominees: SuperlativeNominee[] }) | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await db
    .select({
      id: a.id,
      startDate: bootcamps.startDate,
      superlatives: s.superlatives,
      nominees: s.nominees,
      votes: a.votes,
      submittedAt: a.submittedAt,
    })
    .from(a)
    .innerJoin(s, eq(s.id, a.surveyId))
    .innerJoin(bootcamps, eq(bootcamps.id, s.bootcampId))
    .where(and(eq(a.id, id), eq(a.email, email.toLowerCase()), isNull(s.unassignedAt)));
  if (!row) return null;
  return {
    ...row,
    ballot: ballotFor(row.nominees, email),
    submittedAt: row.submittedAt?.toISOString() ?? null,
  };
}

export type SaveSuperlativesError = SuperlativeVoteProblem | { problem: "not_found" };

/** Checks `email`'s votes on their superlatives survey `id` and keeps them, in place of any they gave before. */
export async function saveMySuperlatives(
  email: string,
  id: string,
  submission: SuperlativeSubmission,
): Promise<{ ok: true; survey: MySuperlatives } | { ok: false; error: SaveSuperlativesError }> {
  const mine = await loadMine(email, id);
  if (!mine) return { ok: false, error: { problem: "not_found" } };
  const checked = checkSuperlativeVotes(mine.superlatives, mine.nominees, email, submission);
  if (!checked.ok) return checked;
  const [row] = await db
    .update(a)
    .set({ votes: checked.votes, submittedAt: new Date() })
    .where(eq(a.id, id))
    .returning({ submittedAt: a.submittedAt });
  noteAudit({ target: id, targetLabel: `Superlatives, ${surveyMonth(mine.startDate)} Bootcamp: ${email.toLowerCase()}` });
  return { ok: true, survey: shown({ ...mine, votes: checked.votes, submittedAt: row!.submittedAt!.toISOString() }) };
}

/** A Bootcamp's superlatives survey with at least one vote, as Survey Results shows it. */
export type SuperlativeResultCard = {
  id: string;
  bootcampId: string;
  startDate: string;
  superlatives: number;
  assigned: number;
  responses: number;
};

const responses = sql<number>`count(${a.submittedAt})::int`;

/** The superlatives surveys anyone has voted on, the latest Bootcamp first, at most a page of them. */
export async function listSuperlativeResults(): Promise<SuperlativeResultCard[]> {
  return db
    .select({
      id: s.id,
      bootcampId: s.bootcampId,
      startDate: bootcamps.startDate,
      superlatives: sql<number>`jsonb_array_length(${s.superlatives})::int`,
      assigned: sql<number>`count(${a.id})::int`,
      responses,
    })
    .from(s)
    .innerJoin(bootcamps, eq(bootcamps.id, s.bootcampId))
    .innerJoin(a, eq(a.surveyId, s.id))
    .groupBy(s.id, bootcamps.startDate)
    .having(sql`count(${a.submittedAt}) > 0`)
    .orderBy(desc(bootcamps.startDate))
    .limit(PAGE_SIZE);
}

/** One superlative's votes: everyone voted for, the most votes first. */
export type SuperlativeTally = Superlative & { votes: number; standings: SuperlativeStanding[] };

export type SuperlativeResult = Omit<SuperlativeResultCard, "superlatives"> & {
  /** Whether it is unassigned now, so hidden from the class. */
  unassigned: boolean;
  superlatives: SuperlativeTally[];
};

/** A superlatives survey and the votes on each superlative, or null. */
export async function getSuperlativeResult(id: string): Promise<SuperlativeResult | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await db
    .select({
      id: s.id,
      bootcampId: s.bootcampId,
      startDate: bootcamps.startDate,
      superlatives: s.superlatives,
      nominees: s.nominees,
      unassignedAt: s.unassignedAt,
      assigned: sql<number>`count(${a.id})::int`,
      responses,
    })
    .from(s)
    .innerJoin(bootcamps, eq(bootcamps.id, s.bootcampId))
    .leftJoin(a, eq(a.surveyId, s.id))
    .where(eq(s.id, id))
    .groupBy(s.id, bootcamps.startDate);
  if (!row) return null;

  // One row per superlative and classmate voted for: at most the list's length times the class.
  const counts = await db
    .select({ superlativeId: sql<string>`vote.key`, email: sql<string>`vote.value`, votes: sql<number>`count(*)::int` })
    .from(sql`${a}, jsonb_each_text(${a.votes}) as vote`)
    .where(and(eq(a.surveyId, id), isNotNull(a.submittedAt)))
    .groupBy(sql`vote.key`, sql`vote.value`);
  const names = new Map(row.nominees.map((n) => [n.email, n.fullName]));

  return {
    id: row.id,
    bootcampId: row.bootcampId,
    startDate: row.startDate,
    assigned: row.assigned,
    responses: row.responses,
    unassigned: row.unassignedAt !== null,
    superlatives: row.superlatives.map((x) => {
      const standings = counts
        .filter((c) => c.superlativeId === x.id)
        .map((c) => ({ email: c.email, fullName: names.get(c.email) || c.email, votes: c.votes }))
        .sort((p, q) => q.votes - p.votes || p.fullName.localeCompare(q.fullName));
      return { ...x, votes: standings.reduce((n, c) => n + c.votes, 0), standings };
    }),
  };
}

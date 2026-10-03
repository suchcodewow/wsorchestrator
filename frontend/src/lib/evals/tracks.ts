/**
 * Keeping `employees.track` in step with bootcamp history, the title lists,
 * the deferral window, the next bootcamp and the tracks administrators set
 * by hand. The sync sets every track as it stores the org; a change to any
 * of those afterwards resets the tracks it touches here, so none waits for
 * the next sync.
 */

import "server-only";

import { and, asc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bootcampHistory,
  bootcamps,
  employees,
  employeeTrackOverrides,
  EXEMPT_DATE,
  type EmployeeTrack,
  type EvalsTitleList,
} from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import { getDeferralDays } from "@/lib/evals/settings";
import { cleanTitle, titleKey, trackFor, type DeferralRule, type TrackOverride } from "@/lib/evals/title-lists";
import { addTitles, titleListMap } from "@/lib/evals/titles";

const isExempt = or(eq(bootcampHistory.btcDate, EXEMPT_DATE), eq(bootcampHistory.intDate, EXEMPT_DATE));

/** Everyone whose history marks BTC or INT exempt, by lowercased email. */
export async function exemptEmails(): Promise<Set<string>> {
  const rows = await db.select({ email: bootcampHistory.email }).from(bootcampHistory).where(isExempt);
  return new Set(rows.map((r) => r.email));
}

/** The tracks administrators set by hand, by lowercased email; only these emails' when given. */
export async function trackOverrides(emails?: readonly string[]): Promise<Map<string, TrackOverride>> {
  const rows = await db
    .select({ email: employeeTrackOverrides.email, track: employeeTrackOverrides.track })
    .from(employeeTrackOverrides)
    .where(emails ? inArray(employeeTrackOverrides.email, [...emails]) : undefined);
  return new Map(rows.map((r) => [r.email, { track: r.track }]));
}

/**
 * The bootcamp that deferral counts back from: the active one, or else the
 * soonest scheduled one that has not started yet.
 */
export async function nextBootcampStart(): Promise<string | null> {
  const [next] = await db
    .select({ startDate: bootcamps.startDate })
    .from(bootcamps)
    .where(or(eq(bootcamps.status, "active"), gte(bootcamps.startDate, sql`current_date`)))
    .orderBy(sql`(${bootcamps.status} = 'active') desc`, asc(bootcamps.startDate))
    .limit(1);
  return next?.startDate ?? null;
}

/** The deferral window against the next bootcamp, or null when either is missing. */
export async function deferralRule(): Promise<DeferralRule | null> {
  const [days, bootcampStart] = await Promise.all([getDeferralDays(), nextBootcampStart()]);
  return bootcampStart && days > 0 ? { bootcampStart, days } : null;
}

const BATCH = 100;

/**
 * Resets the track of the org members with these emails, from their history,
 * the lists, the deferral rule and any track set by hand, as they all stand.
 * Returns how many tracks changed.
 */
export async function retrackEmployees(emails: readonly string[]): Promise<number> {
  const wanted = [...new Set(emails.map((e) => e.toLowerCase()))];
  let changed = 0;
  if (wanted.length === 0) return changed;
  const [lists, deferral] = await Promise.all([titleListMap(), deferralRule()]);
  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = wanted.slice(i, i + BATCH);
    const people = await db
      .select({
        id: employees.id,
        email: employees.email,
        title: employees.title,
        startDate: employees.startDate,
        track: employees.track,
      })
      .from(employees)
      .where(and(isNotNull(employees.orgDepth), inArray(employees.email, batch)));
    if (people.length === 0) continue;
    const [exemptRows, overrides] = await Promise.all([
      db
        .select({ email: bootcampHistory.email })
        .from(bootcampHistory)
        .where(and(isExempt, inArray(bootcampHistory.email, batch))),
      trackOverrides(batch),
    ]);
    const exempt = new Set(exemptRows.map((r) => r.email));
    for (const p of people) {
      const track = trackFor(
        {
          inOrg: true,
          title: p.title,
          exempt: exempt.has(p.email),
          startDate: p.startDate,
          override: overrides.get(p.email),
        },
        lists,
        deferral,
      );
      if (track === p.track) continue;
      await db.update(employees).set({ track }).where(eq(employees.id, p.id));
      changed++;
    }
  }
  return changed;
}

/**
 * Resets every org member's track: for a change that can move anyone, such
 * as the deferral window or the next bootcamp.
 */
export async function retrackOrg(): Promise<number> {
  const org = await db.select({ email: employees.email }).from(employees).where(isNotNull(employees.orgDepth));
  return retrackEmployees(org.map((p) => p.email));
}

/** What an administrator can set: any track, `undecided` to keep none, or `automatic` to let the rules decide again. */
export const TRACK_CHOICES = ["sales", "engineer", "undecided", "deferred", "ignored", "exempt", "automatic"] as const;
export type TrackChoice = (typeof TRACK_CHOICES)[number];

export type SetTrackResult = {
  email: string;
  /** The track they have now; null for undecided. */
  track: EmployeeTrack | null;
  /** Whether that track was set by hand, rather than by the rules. */
  overridden: boolean;
};

/**
 * Sets one org member's track by hand, whatever the rules say, until someone
 * picks `automatic`. It lasts through every sync.
 */
export async function setTrack(
  actorId: string,
  email: string,
  choice: TrackChoice,
): Promise<{ ok: true; result: SetTrackResult } | { ok: false; error: "not_found" }> {
  const lower = email.trim().toLowerCase();
  const [person] = await db
    .select({ fullName: employees.fullName, track: employees.track })
    .from(employees)
    .where(and(isNotNull(employees.orgDepth), eq(employees.email, lower)));
  if (!person) return { ok: false, error: "not_found" };
  noteAudit({ target: lower, targetLabel: person.fullName });

  if (choice === "automatic") {
    await db.delete(employeeTrackOverrides).where(eq(employeeTrackOverrides.email, lower));
  } else {
    const track = choice === "undecided" ? null : choice;
    await db
      .insert(employeeTrackOverrides)
      .values({ email: lower, track, updatedBy: actorId })
      .onConflictDoUpdate({
        target: employeeTrackOverrides.email,
        set: { track, updatedBy: actorId, updatedAt: new Date() },
      });
  }
  await retrackEmployees([lower]);

  const [now] = await db
    .select({ track: employees.track })
    .from(employees)
    .where(and(isNotNull(employees.orgDepth), eq(employees.email, lower)));
  const track = now?.track ?? null;
  noteAudit({ detail: { choice, from: person.track ?? "undecided", to: track ?? "undecided" } });
  return { ok: true, result: { email: lower, track, overridden: choice !== "automatic" } };
}

export type SortTitleError = "not_found" | "not_undecided" | "no_title";

export type SortTitleResult = {
  title: string;
  /** The list the title is on now: the one asked for, or the one it was already on. */
  list: EvalsTitleList;
  /** False when the title was already on a list, which then decided. */
  added: boolean;
  /** Org members whose track changed, this person included. */
  retracked: number;
};

/**
 * Sorts an undecided org member by their title: puts the title on `list`,
 * then resets the track of everyone in the org who holds it, so they all
 * move at once rather than at the next sync.
 */
export async function sortUndecidedTitle(
  actorId: string,
  email: string,
  list: EvalsTitleList,
): Promise<{ ok: true; result: SortTitleResult } | { ok: false; error: SortTitleError }> {
  const [person] = await db
    .select({ fullName: employees.fullName, title: employees.title, track: employees.track })
    .from(employees)
    .where(and(isNotNull(employees.orgDepth), eq(employees.email, email.trim().toLowerCase())));
  if (!person) return { ok: false, error: "not_found" };
  noteAudit({ target: email, targetLabel: person.fullName });
  if (person.track !== null) return { ok: false, error: "not_undecided" };
  const title = cleanTitle(person.title);
  if (!title) return { ok: false, error: "no_title" };

  const { added, existing } = await addTitles(actorId, list, [title]);
  const onList = added.length > 0 ? list : (existing[0]?.list ?? list);

  const holders = await db
    .select({ email: employees.email })
    .from(employees)
    .where(
      and(
        isNotNull(employees.orgDepth),
        sql`lower(btrim(regexp_replace(${employees.title}, '\\s+', ' ', 'g'))) = ${titleKey(title)}`,
      ),
    );
  const retracked = await retrackEmployees(holders.map((h) => h.email));
  noteAudit({ detail: { title, list: onList, added: added.length > 0, retracked } });
  return { ok: true, result: { title, list: onList, added: added.length > 0, retracked } };
}

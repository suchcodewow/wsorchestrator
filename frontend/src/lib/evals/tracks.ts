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
  EVALS_TITLE_LISTS,
  evalsTitles,
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
    .where(
      or(
        eq(bootcamps.status, "active"),
        and(eq(bootcamps.status, "scheduled"), gte(bootcamps.startDate, sql`current_date`)),
      ),
    )
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

/** The title list a choice puts the person's title on, if it is one. */
const LIST_CHOICES: readonly TrackChoice[] = EVALS_TITLE_LISTS;
const isListChoice = (c: TrackChoice): c is EvalsTitleList => LIST_CHOICES.includes(c);

export type SetTrackResult = {
  email: string;
  /** The track they have now; null for undecided. */
  track: EmployeeTrack | null;
  /** Whether that track was set by hand, rather than by the rules. */
  overridden: boolean;
  /** The title a list choice put on that list, and the list it was on before; null when no list changed. */
  title: { title: string; list: EvalsTitleList; from: EvalsTitleList | null } | null;
  /** Org members whose track changed, this person included. */
  retracked: number;
};

/** Everyone in the org who holds this title, compared as the lists compare titles. */
async function holdersOf(title: string): Promise<string[]> {
  const rows = await db
    .select({ email: employees.email })
    .from(employees)
    .where(
      and(
        isNotNull(employees.orgDepth),
        sql`lower(btrim(regexp_replace(${employees.title}, '\\s+', ' ', 'g'))) = ${titleKey(title)}`,
      ),
    );
  return rows.map((r) => r.email);
}

/**
 * Puts `title` on `list`, moving it off another list if it is on one.
 * Returns the title as the list spells it and the list it was on before
 * (null if none), or undefined when it was on `list` already.
 */
async function placeTitle(
  actorId: string,
  title: string,
  list: EvalsTitleList,
): Promise<{ title: string; from: EvalsTitleList | null } | undefined> {
  const [row] = await db
    .select({ id: evalsTitles.id, title: evalsTitles.title, list: evalsTitles.list })
    .from(evalsTitles)
    .where(sql`lower(${evalsTitles.title}) = ${titleKey(title)}`);
  if (row?.list === list) return undefined;
  if (row) {
    await db.update(evalsTitles).set({ list }).where(eq(evalsTitles.id, row.id));
    return { title: row.title, from: row.list as EvalsTitleList };
  }
  await db.insert(evalsTitles).values({ list, title, createdBy: actorId }).onConflictDoNothing();
  return { title, from: null };
}

async function pin(actorId: string, email: string, track: EmployeeTrack | null) {
  await db
    .insert(employeeTrackOverrides)
    .values({ email, track, updatedBy: actorId })
    .onConflictDoUpdate({
      target: employeeTrackOverrides.email,
      set: { track, updatedBy: actorId, updatedAt: new Date() },
    });
}

/**
 * Sets one org member's track, whatever the rules say.
 *
 * Sales, Engineer and Ignored are title lists: picking one puts the person's
 * title on it, moving it off another list if need be, and retracks everyone
 * in the org who holds that title. The person themselves is pinned to the
 * choice only where the rules still give them something else, such as exempt
 * history or a late start; anyone else with the title who was set by hand
 * keeps that. Undecided, Deferred and Exempt pin just this person, until
 * someone picks `automatic`. A pin lasts through every sync.
 */
export async function setTrack(
  actorId: string,
  email: string,
  choice: TrackChoice,
): Promise<{ ok: true; result: SetTrackResult } | { ok: false; error: "not_found" }> {
  const lower = email.trim().toLowerCase();
  const [person] = await db
    .select({ fullName: employees.fullName, title: employees.title, track: employees.track })
    .from(employees)
    .where(and(isNotNull(employees.orgDepth), eq(employees.email, lower)));
  if (!person) return { ok: false, error: "not_found" };
  noteAudit({ target: lower, targetLabel: person.fullName });

  const title = isListChoice(choice) ? cleanTitle(person.title) : "";
  let moved: SetTrackResult["title"] = null;
  let retracked: number;
  if (isListChoice(choice) && title) {
    const holders = await holdersOf(title);
    if (!holders.includes(lower)) holders.push(lower);
    const tracksOf = async () =>
      new Map(
        (await db.select({ email: employees.email, track: employees.track }).from(employees).where(inArray(employees.email, holders))).map(
          (r) => [r.email, r.track],
        ),
      );
    const before = await tracksOf();
    await db.delete(employeeTrackOverrides).where(eq(employeeTrackOverrides.email, lower));
    const placed = await placeTitle(actorId, title, choice);
    if (placed) moved = { ...placed, list: choice };
    await retrackEmployees(holders);
    const [after] = await db.select({ track: employees.track }).from(employees).where(eq(employees.email, lower));
    if (after?.track !== choice) {
      await pin(actorId, lower, choice);
      await retrackEmployees([lower]);
    }
    const now = await tracksOf();
    retracked = holders.filter((e) => before.get(e) !== now.get(e)).length;
  } else if (choice === "automatic") {
    await db.delete(employeeTrackOverrides).where(eq(employeeTrackOverrides.email, lower));
    retracked = await retrackEmployees([lower]);
  } else {
    await pin(actorId, lower, choice === "undecided" ? null : choice);
    retracked = await retrackEmployees([lower]);
  }

  const [now] = await db
    .select({ track: employees.track, overridden: employeeTrackOverrides.email })
    .from(employees)
    .leftJoin(employeeTrackOverrides, eq(employeeTrackOverrides.email, employees.email))
    .where(and(isNotNull(employees.orgDepth), eq(employees.email, lower)));
  const track = now?.track ?? null;
  const overridden = now?.overridden != null;
  noteAudit({
    detail: { choice, from: person.track ?? "undecided", to: track ?? "undecided", overridden, title: moved, retracked },
  });
  return { ok: true, result: { email: lower, track, overridden, title: moved, retracked } };
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

  const retracked = await retrackEmployees(await holdersOf(title));
  noteAudit({ detail: { title, list: onList, added: added.length > 0, retracked } });
  return { ok: true, result: { title, list: onList, added: added.length > 0, retracked } };
}

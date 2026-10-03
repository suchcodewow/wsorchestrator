/**
 * Keeping `employees.track` in step with bootcamp history and the title
 * lists. The sync sets every track as it stores the org; a change to
 * someone's history afterwards resets theirs here, as does sorting an
 * undecided title from the Cohorts page, so neither waits for the next sync.
 */

import "server-only";

import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bootcampHistory, employees, EXEMPT_DATE, type EvalsTitleList } from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import { cleanTitle, titleKey, trackFor } from "@/lib/evals/title-lists";
import { addTitles, titleListMap } from "@/lib/evals/titles";

const isExempt = or(eq(bootcampHistory.btcDate, EXEMPT_DATE), eq(bootcampHistory.intDate, EXEMPT_DATE));

/** Everyone whose history marks BTC or INT exempt, by lowercased email. */
export async function exemptEmails(): Promise<Set<string>> {
  const rows = await db.select({ email: bootcampHistory.email }).from(bootcampHistory).where(isExempt);
  return new Set(rows.map((r) => r.email));
}

const BATCH = 100;

/**
 * Resets the track of the org members with these emails, from their history
 * and the lists as they stand. Returns how many tracks changed.
 */
export async function retrackEmployees(emails: readonly string[]): Promise<number> {
  const wanted = [...new Set(emails.map((e) => e.toLowerCase()))];
  let changed = 0;
  if (wanted.length === 0) return changed;
  const lists = await titleListMap();
  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = wanted.slice(i, i + BATCH);
    const people = await db
      .select({ id: employees.id, email: employees.email, title: employees.title, track: employees.track })
      .from(employees)
      .where(and(isNotNull(employees.orgDepth), inArray(employees.email, batch)));
    if (people.length === 0) continue;
    const exempt = new Set(
      (
        await db
          .select({ email: bootcampHistory.email })
          .from(bootcampHistory)
          .where(and(isExempt, inArray(bootcampHistory.email, batch)))
      ).map((r) => r.email),
    );
    for (const p of people) {
      const track = trackFor({ inOrg: true, title: p.title, exempt: exempt.has(p.email) }, lists);
      if (track === p.track) continue;
      await db.update(employees).set({ track }).where(eq(employees.id, p.id));
      changed++;
    }
  }
  return changed;
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

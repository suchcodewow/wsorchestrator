/**
 * Keeping `employees.track` in step with bootcamp history. The sync sets
 * every track as it stores the org; a change to someone's history afterwards
 * resets theirs here, so marking a class exempt takes effect without waiting
 * for the next sync.
 */

import "server-only";

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { bootcampHistory, employees, EXEMPT_DATE } from "@/db/schema";
import { trackFor } from "@/lib/evals/title-lists";
import { titleListMap } from "@/lib/evals/titles";

const isExempt = or(eq(bootcampHistory.btcDate, EXEMPT_DATE), eq(bootcampHistory.intDate, EXEMPT_DATE));

/** Everyone whose history marks BTC or INT exempt, by lowercased email. */
export async function exemptEmails(): Promise<Set<string>> {
  const rows = await db.select({ email: bootcampHistory.email }).from(bootcampHistory).where(isExempt);
  return new Set(rows.map((r) => r.email));
}

const BATCH = 100;

/** Resets the track of the org members with these emails, from their history and the lists as they stand. */
export async function retrackEmployees(emails: readonly string[]): Promise<void> {
  const wanted = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (wanted.length === 0) return;
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
      if (track !== p.track) await db.update(employees).set({ track }).where(eq(employees.id, p.id));
    }
  }
}

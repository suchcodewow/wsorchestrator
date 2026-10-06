/**
 * The Canary Wire's stored pull, and the month view built from it with
 * bootcamp history and the HiBob sync: who people are and whom they report
 * to, and when they started. Reporting → Canary Wire and
 * `GET /api/evals/canary-wire` both read through `canaryWireView`.
 */

import "server-only";

import { desc, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { EXEMPT_DATE, bootcampHistory, canaryWireSnapshots, employees } from "@/db/schema";
import { accountability, type History } from "@/lib/canary-wire/exemptions";
import { managersOf, onlyOrg, orgOf, withHiBob, type Person } from "@/lib/canary-wire/people";
import type { CanaryWireScope } from "@/lib/canary-wire/scope";
import { canaryWireSnapshotSchema, type CanaryWireSnapshot } from "@/lib/canary-wire/snapshot";
import { defaultMonth, emptyView, monthLastActivity, monthView, offeredMonths, type CanaryWireView } from "@/lib/canary-wire/view";

export type StoredSnapshot = { snapshot: CanaryWireSnapshot; savedAt: Date };

async function latestSnapshot(): Promise<StoredSnapshot | null> {
  const [row] = await db
    .select({ data: canaryWireSnapshots.data, savedAt: canaryWireSnapshots.savedAt })
    .from(canaryWireSnapshots)
    .orderBy(desc(canaryWireSnapshots.savedAt))
    .limit(1);
  if (!row) return null;
  // Checked when it was saved; parsed again so a row written by an older
  // shape fails here rather than as an undefined field on the page.
  const parsed = canaryWireSnapshotSchema.safeParse(row.data);
  return parsed.success ? { snapshot: parsed.data, savedAt: row.savedAt } : null;
}

/** Stores a pull and deletes every older one: only the newest is ever read. */
export async function saveSnapshot(snapshot: CanaryWireSnapshot, savedBy: string | null): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(canaryWireSnapshots)
      .values({ fetchedAt: new Date(snapshot.fetched_at), learners: snapshot.learners.length, data: snapshot, savedBy })
      .returning({ id: canaryWireSnapshots.id });
    await tx.delete(canaryWireSnapshots).where(ne(canaryWireSnapshots.id, row!.id));
    return row!;
  });
}

/** Everyone in the last HiBob sync, by lowercased email. */
async function peopleByEmail(): Promise<Map<string, Person>> {
  const rows = await db
    .select({
      email: employees.email,
      fullName: employees.fullName,
      title: employees.title,
      reportsToEmail: employees.reportsToEmail,
      reportsToName: employees.reportsToName,
    })
    .from(employees);
  return new Map(rows.map((r) => [r.email, r]));
}

/** What bootcamp history and HiBob say about who has been through bootcamp. */
async function history(): Promise<History> {
  const [btc, starts] = await Promise.all([
    db
      .select({ email: bootcampHistory.email, btcDate: bootcampHistory.btcDate })
      .from(bootcampHistory)
      .where(isNotNull(bootcampHistory.btcDate)),
    db.select({ email: employees.email, startDate: employees.startDate }).from(employees).where(isNotNull(employees.startDate)),
  ]);
  const real = btc.map((r) => r.btcDate!).filter((d) => d !== EXEMPT_DATE).sort();
  return {
    btcDates: new Map(btc.map((r) => [r.email, r.btcDate!])),
    startDates: new Map(starts.map((r) => [r.email, r.startDate!])),
    historyBegins: real[0] ?? null,
  };
}

/**
 * One month of the Canary Wire, or the newest month anybody worked in when
 * `month` is null. Null for a month the picker doesn't offer.
 */
/**
 * One month of the Canary Wire for `scope`. Reps are filtered before anything
 * is counted, so every rate on the page is over the people shown.
 */
export async function canaryWireView(month: string | null, scope: CanaryWireScope = { kind: "everyone" }): Promise<CanaryWireView | null> {
  const [stored, known] = await Promise.all([latestSnapshot(), history()]);
  const snap = stored?.snapshot ?? null;
  const chosen = month ?? defaultMonth(snap);
  if (!offeredMonths(snap).includes(chosen)) return null;
  if (!stored) return { ...emptyView(chosen), scope: scope.kind };
  const people = await peopleByEmail();
  const named = withHiBob(stored.snapshot, people);
  const shown = scope.kind === "org" ? onlyOrg(named, orgOf(people, scope.email)) : named;
  return {
    ...monthView(shown, chosen, accountability(known), stored.savedAt, managersOf(people)),
    lastActivity: monthLastActivity(named, chosen),
    scope: scope.kind,
  };
}

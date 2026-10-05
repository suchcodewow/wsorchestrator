/**
 * The Canary Wire's stored pull and hand-set exemptions, and the month view
 * built from them with bootcamp history. Reporting → Canary Wire and
 * `GET /api/evals/canary-wire` both read through `canaryWireView`.
 */

import "server-only";

import { asc, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { bootcampHistory, canaryWireExemptions, canaryWireSnapshots, users } from "@/db/schema";
import { accountability, type ParsedExemption } from "@/lib/canary-wire/exemptions";
import { canaryWireSnapshotSchema, type CanaryWireSnapshot } from "@/lib/canary-wire/snapshot";
import { defaultMonth, emptyView, monthView, offeredMonths, type CanaryWireView } from "@/lib/canary-wire/view";

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

export async function listExemptions(): Promise<(ParsedExemption & { updatedAt: Date; updatedByName: string | null })[]> {
  return db
    .select({
      email: canaryWireExemptions.email,
      accountableFrom: canaryWireExemptions.accountableFrom,
      updatedAt: canaryWireExemptions.updatedAt,
      updatedByName: users.name,
    })
    .from(canaryWireExemptions)
    .leftJoin(users, eq(users.id, canaryWireExemptions.updatedBy))
    .orderBy(asc(canaryWireExemptions.email));
}

/**
 * Replaces the whole list, as the dialog saves it. A person whose line is
 * unchanged keeps their row's date and author, so the list says who last
 * changed each one rather than who last pressed Save.
 */
export async function replaceExemptions(rows: ParsedExemption[], updatedBy: string | null): Promise<{ added: number; changed: number; removed: number }> {
  return db.transaction(async (tx) => {
    const before = new Map(
      (await tx.select().from(canaryWireExemptions)).map((r) => [r.email, r.accountableFrom]),
    );
    const wanted = new Map(rows.map((r) => [r.email, r.accountableFrom]));
    let added = 0;
    let changed = 0;
    let removed = 0;
    for (const email of before.keys()) {
      if (wanted.has(email)) continue;
      await tx.delete(canaryWireExemptions).where(eq(canaryWireExemptions.email, email));
      removed++;
    }
    for (const [email, accountableFrom] of wanted) {
      if (!before.has(email)) {
        await tx.insert(canaryWireExemptions).values({ email, accountableFrom, updatedBy });
        added++;
      } else if (before.get(email) !== accountableFrom) {
        await tx
          .update(canaryWireExemptions)
          .set({ accountableFrom, updatedBy, updatedAt: new Date() })
          .where(eq(canaryWireExemptions.email, email));
        changed++;
      }
    }
    return { added, changed, removed };
  });
}

async function btcDates(): Promise<Map<string, string>> {
  const rows = await db
    .select({ email: bootcampHistory.email, btcDate: bootcampHistory.btcDate })
    .from(bootcampHistory)
    .where(isNotNull(bootcampHistory.btcDate));
  return new Map(rows.map((r) => [r.email, r.btcDate!]));
}

/**
 * One month of the Canary Wire, or the newest month anybody worked in when
 * `month` is null. Null for a month the picker doesn't offer.
 */
export async function canaryWireView(month: string | null): Promise<CanaryWireView | null> {
  const [stored, overrides, dates] = await Promise.all([latestSnapshot(), listExemptions(), btcDates()]);
  const snap = stored?.snapshot ?? null;
  const chosen = month ?? defaultMonth(snap);
  if (!offeredMonths(snap).includes(chosen)) return null;
  if (!stored) return emptyView(chosen);
  const standing = accountability(new Map(overrides.map((o) => [o.email, o.accountableFrom])), dates);
  return monthView(stored.snapshot, chosen, standing, stored.savedAt);
}

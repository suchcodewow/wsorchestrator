/**
 * Who has opened each person's card on Reporting → Live Sessions. The card
 * records a view as it opens; the lists show an eye beside anyone whose card
 * has been opened, naming who opened it.
 */

import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { scorecardViews, users } from "@/db/schema";
import { canReach, resolvePerson, type BootcampReader, type CardViewer } from "@/lib/reporting/bootcamp";

/** Most viewers `listCardViewers` returns. */
const VIEWERS_MAX = 100;

/** Records that `viewerId` opened the card `key` names; null for a card they may not see. */
export async function recordCardView(viewerId: string, reader: BootcampReader, key: string): Promise<{ email: string } | null> {
  const email = await resolvePerson(key);
  if (!email || !(await canReach(reader, email))) return null;
  await db
    .insert(scorecardViews)
    .values({ attendeeEmail: email, viewerId })
    .onConflictDoUpdate({
      target: [scorecardViews.attendeeEmail, scorecardViews.viewerId],
      set: { views: sql`${scorecardViews.views} + 1`, lastViewedAt: new Date() },
    });
  return { email };
}

/** Everyone who has opened the card `key` names, newest first, at most 100; null for a card the reader may not see. */
export async function listCardViewers(
  reader: BootcampReader,
  key: string,
): Promise<{ viewers: (CardViewer & { views: number })[]; total: number } | null> {
  const email = await resolvePerson(key);
  if (!email || !(await canReach(reader, email))) return null;
  const [rows, [count]] = await Promise.all([
    db
      .select({
        name: sql<string>`coalesce(nullif(${users.name}, ''), ${users.email})`,
        at: scorecardViews.lastViewedAt,
        views: scorecardViews.views,
      })
      .from(scorecardViews)
      .innerJoin(users, eq(users.id, scorecardViews.viewerId))
      .where(eq(scorecardViews.attendeeEmail, email))
      .orderBy(desc(scorecardViews.lastViewedAt))
      .limit(VIEWERS_MAX),
    db.select({ n: sql<number>`count(*)::int` }).from(scorecardViews).where(eq(scorecardViews.attendeeEmail, email)),
  ]);
  return { viewers: rows.map((r) => ({ ...r, at: r.at.toISOString() })), total: count?.n ?? 0 };
}

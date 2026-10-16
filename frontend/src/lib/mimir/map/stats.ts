/**
 * How each person uses the map coach: messages typed, the most concepts they
 * have ever had mastered, and new conversations started. Write-only on
 * purpose: nothing in the app reads these back. They are for the people who
 * run Mimir to query in the database.
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { mimirCoachStats } from "@/db/schema";

const t = mimirCoachStats;

/** They typed a message to the coach. */
export async function countMessage(userId: string): Promise<void> {
  await db
    .insert(t)
    .values({ userId, messagesSent: 1 })
    .onConflictDoUpdate({ target: t.userId, set: { messagesSent: sql`${t.messagesSent} + 1`, updatedAt: new Date() } });
}

/** They stand mastered on `mastered` concepts now; the record only ever goes up. */
export async function notePeakMastered(userId: string, mastered: number): Promise<void> {
  await db
    .insert(t)
    .values({ userId, peakMastered: mastered })
    .onConflictDoUpdate({
      target: t.userId,
      set: { peakMastered: sql`greatest(${t.peakMastered}, ${mastered})`, updatedAt: new Date() },
      setWhere: sql`${t.peakMastered} < ${mastered}`,
    });
}

/** They pressed "New conversation". */
export async function countNewConversation(userId: string): Promise<void> {
  await db
    .insert(t)
    .values({ userId, newConversations: 1 })
    .onConflictDoUpdate({ target: t.userId, set: { newConversations: sql`${t.newConversations} + 1`, updatedAt: new Date() } });
}

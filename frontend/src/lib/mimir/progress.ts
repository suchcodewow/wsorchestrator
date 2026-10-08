/**
 * Where each person is with Mimir: which items they have opened, practiced
 * with the coach and mastered, the one-line takeaways they wrote, and what
 * they have told the coach about themselves. Everything here is the signed-in
 * person's own; nobody reads anyone else's.
 */

import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  MIMIR_COACH_STYLES,
  MIMIR_REFLECTION_MAX,
  MIMIR_REP_ROLES,
  mimirConversations,
  mimirItems,
  mimirMessages,
  mimirProfiles,
  mimirProgress,
  type MimirCoachStyle,
  type MimirKind,
  type MimirRepRole,
} from "@/db/schema";
import { PROGRESS_KINDS, tierOf, type Tier } from "@/lib/mimir/kinds";
import type { MimirProgressSort } from "@/lib/list-specs";
import { PAGE_SIZE, pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

export type ItemProgress = {
  tier: Tier;
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
  masteryReady: boolean;
  reflection: string;
};

const NO_PROGRESS: ItemProgress = {
  tier: "none",
  firstVisitAt: null,
  lastVisitAt: null,
  masteryReady: false,
  reflection: "",
};

/** One person's progress on one item. */
export async function getItemProgress(userId: string, itemId: string): Promise<ItemProgress> {
  const [row] = await db
    .select()
    .from(mimirProgress)
    .where(and(eq(mimirProgress.userId, userId), eq(mimirProgress.itemId, itemId)));
  if (!row) return NO_PROGRESS;
  return {
    tier: tierOf(row),
    firstVisitAt: row.firstVisitAt,
    lastVisitAt: row.lastVisitAt,
    masteryReady: row.masteryReadyAt !== null,
    reflection: row.reflection,
  };
}

/** The item this person opened most recently, to carry on from; null before they have opened any. */
export async function resumePoint(userId: string): Promise<{ id: string; kind: MimirKind; title: string } | null> {
  const [row] = await db
    .select({ id: mimirItems.id, kind: mimirItems.kind, title: mimirItems.title })
    .from(mimirProgress)
    .innerJoin(mimirItems, eq(mimirItems.id, mimirProgress.itemId))
    .where(and(eq(mimirProgress.userId, userId), inArray(mimirItems.kind, [...PROGRESS_KINDS])))
    .orderBy(sql`${mimirProgress.lastVisitAt} desc`)
    .limit(1);
  return row ?? null;
}

/**
 * Takes this person back to the beginning: every item unopened, every
 * conversation gone, every takeaway and mastery cleared. What they told the
 * coach about themselves stays.
 */
export async function resetProgress(userId: string): Promise<{ items: number; conversations: number }> {
  return db.transaction(async (tx) => {
    const conversations = await tx
      .delete(mimirConversations)
      .where(eq(mimirConversations.userId, userId))
      .returning({ id: mimirConversations.id });
    const items = await tx.delete(mimirProgress).where(eq(mimirProgress.userId, userId)).returning({ id: mimirProgress.itemId });
    return { items: items.length, conversations: conversations.length };
  });
}

/** This person's tier on each of `itemIds` (at most a page of them); an item missing from the map is not started. */
export async function tiersFor(userId: string, itemIds: string[]): Promise<Record<string, Tier>> {
  if (itemIds.length === 0) return {};
  const rows = await db
    .select()
    .from(mimirProgress)
    .where(and(eq(mimirProgress.userId, userId), inArray(mimirProgress.itemId, itemIds.slice(0, PAGE_SIZE))));
  return Object.fromEntries(rows.map((r) => [r.itemId, tierOf(r)]));
}

/** Notes that `userId` opened the item; false when there is no such item. */
export async function recordVisit(userId: string, itemId: string): Promise<boolean> {
  const [item] = await db.select({ id: mimirItems.id }).from(mimirItems).where(eq(mimirItems.id, itemId));
  if (!item) return false;
  const now = new Date();
  await db
    .insert(mimirProgress)
    .values({ userId, itemId, firstVisitAt: now, lastVisitAt: now })
    .onConflictDoUpdate({ target: [mimirProgress.userId, mimirProgress.itemId], set: { lastVisitAt: now } });
  return true;
}

export const reflectionSchema = z.object({
  reflection: z.string().trim().min(1).max(MIMIR_REFLECTION_MAX),
});

/**
 * Saves the rep's one-line takeaway, which with the coach's signal makes the
 * item mastered. Refused until the coach has given the signal.
 */
export async function setReflection(
  userId: string,
  itemId: string,
  reflection: string,
): Promise<{ ok: true; tier: Tier } | { ok: false; error: "not_found" | "not_ready" }> {
  const [row] = await db
    .update(mimirProgress)
    .set({ reflection })
    .where(
      and(
        eq(mimirProgress.userId, userId),
        eq(mimirProgress.itemId, itemId),
        sql`${mimirProgress.masteryReadyAt} is not null`,
      ),
    )
    .returning();
  if (row) return { ok: true, tier: tierOf(row) };
  const [item] = await db.select({ id: mimirItems.id }).from(mimirItems).where(eq(mimirItems.id, itemId));
  return { ok: false, error: item ? "not_ready" : "not_found" };
}

/* ------------------------------------------------------------------ */
/* The progress table                                                  */
/* ------------------------------------------------------------------ */

export type ProgressRow = {
  id: string;
  kind: MimirKind;
  title: string;
  emoji: string;
  tier: Tier;
  /** Messages the rep has sent the coach in their current conversation. */
  exchanges: number;
  lastVisitAt: Date | null;
  reflection: string;
};

const tierRank = sql<number>`case
  when ${mimirProgress.masteryReadyAt} is not null and ${mimirProgress.reflection} <> '' then 3
  when ${mimirProgress.practicedAt} is not null then 2
  when ${mimirProgress.userId} is not null then 1
  else 0 end`;

const SORT_COLUMNS = {
  lastVisit: mimirProgress.lastVisitAt,
  title: sql`lower(${mimirItems.title})`,
  kind: mimirItems.kind,
  tier: tierRank,
} as const;

/** Every item progress is kept on, with this person's progress on it, a page at a time. */
export async function listProgress(
  userId: string,
  query: ListQuery<MimirProgressSort>,
  kind?: MimirKind,
): Promise<Page<ProgressRow>> {
  const { limit, offset } = pageWindow(query.page);
  const exchanges = sql<number>`coalesce((
    select count(*)::int from ${mimirMessages} m
    join ${mimirConversations} c on c.id = m.conversation_id
    where c.user_id = ${userId} and c.item_id = ${mimirItems.id} and m.role = 'user' and m.shown
  ), 0)`;
  const rows = await db
    .select({
      id: mimirItems.id,
      kind: mimirItems.kind,
      title: mimirItems.title,
      emoji: mimirItems.emoji,
      lastVisitAt: mimirProgress.lastVisitAt,
      practicedAt: mimirProgress.practicedAt,
      masteryReadyAt: mimirProgress.masteryReadyAt,
      reflection: mimirProgress.reflection,
      visited: sql<boolean>`${mimirProgress.userId} is not null`,
      exchanges,
    })
    .from(mimirItems)
    .leftJoin(mimirProgress, and(eq(mimirProgress.itemId, mimirItems.id), eq(mimirProgress.userId, userId)))
    .where(
      and(
        kind ? eq(mimirItems.kind, kind) : inArray(mimirItems.kind, [...PROGRESS_KINDS]),
        searchAny(query.q, [mimirItems.title]),
      ),
    )
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`lower(${mimirItems.title})`, mimirItems.id))
    .limit(limit)
    .offset(offset);
  return toPage(
    rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      emoji: r.emoji,
      tier: r.visited ? tierOf({ ...r, reflection: r.reflection ?? "" }) : "none",
      exchanges: r.exchanges,
      lastVisitAt: r.lastVisitAt,
      reflection: r.reflection ?? "",
    })),
    query.page,
  );
}

export type ProgressSummary = { total: number; viewed: number; practiced: number; mastered: number };

/** How many items progress is kept on, and how many of them this person has reached each tier on. */
export async function progressSummary(userId: string): Promise<ProgressSummary> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      viewed: sql<number>`count(${mimirProgress.userId})::int`,
      practiced: sql<number>`count(${mimirProgress.practicedAt})::int`,
      mastered: sql<number>`count(*) filter (where ${mimirProgress.masteryReadyAt} is not null and ${mimirProgress.reflection} <> '')::int`,
    })
    .from(mimirItems)
    .leftJoin(mimirProgress, and(eq(mimirProgress.itemId, mimirItems.id), eq(mimirProgress.userId, userId)))
    .where(inArray(mimirItems.kind, [...PROGRESS_KINDS]));
  return row ?? { total: 0, viewed: 0, practiced: 0, mastered: 0 };
}

/** The agents and capabilities this person has practiced or mastered, for the coach to calibrate to. */
export async function practicedCapabilities(
  userId: string,
): Promise<{ title: string; tier: Tier; reflection: string }[]> {
  const rows = await db
    .select({
      title: mimirItems.title,
      practicedAt: mimirProgress.practicedAt,
      masteryReadyAt: mimirProgress.masteryReadyAt,
      reflection: mimirProgress.reflection,
    })
    .from(mimirProgress)
    .innerJoin(mimirItems, eq(mimirItems.id, mimirProgress.itemId))
    .where(
      and(
        eq(mimirProgress.userId, userId),
        inArray(mimirItems.kind, ["agent", "capability"]),
        sql`${mimirProgress.practicedAt} is not null`,
      ),
    )
    .orderBy(mimirItems.kind, mimirItems.position, mimirItems.id)
    .limit(PAGE_SIZE);
  return rows.map((r) => ({ title: r.title, tier: tierOf(r), reflection: r.reflection }));
}

/* ------------------------------------------------------------------ */
/* The rep's profile                                                   */
/* ------------------------------------------------------------------ */

export type MimirProfile = { role: MimirRepRole | null; coachStyle: MimirCoachStyle };

export async function getProfile(userId: string): Promise<MimirProfile> {
  const [row] = await db
    .select({ role: mimirProfiles.role, coachStyle: mimirProfiles.coachStyle })
    .from(mimirProfiles)
    .where(eq(mimirProfiles.userId, userId));
  return row ?? { role: null, coachStyle: "socratic" };
}

export const profileSchema = z.object({
  role: z.enum(MIMIR_REP_ROLES).nullable(),
  coachStyle: z.enum(MIMIR_COACH_STYLES),
});

/** Saves it. Conversations already under way keep the prompt they started with. */
export async function setProfile(userId: string, profile: MimirProfile): Promise<void> {
  await db
    .insert(mimirProfiles)
    .values({ userId, ...profile })
    .onConflictDoUpdate({ target: mimirProfiles.userId, set: { ...profile, updatedAt: new Date() } });
}

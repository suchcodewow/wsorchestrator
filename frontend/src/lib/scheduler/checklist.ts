/**
 * What is to be done before each day of each of a bootcamp's tracks starts,
 * the SE tracks included. A track-day's list holds at most
 * `CHECKLIST_LIMITS.itemsPerDay`, so it is read whole; what one person owns
 * across every bootcamp is read a page at a time.
 *
 * Any Training administrator adds, edits, ticks and removes items. An item's owner,
 * an administrator or guest judge of the bootcamp, can tick their own as well,
 * from their inbox, whatever other access they hold.
 */

import "server-only";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  CHECKLIST_LIMITS,
  CHECKLIST_TRACKS,
  SCHEDULE_LIMITS,
  bootcamps,
  mentions,
  scheduleChecklistItems,
  users,
  type ChecklistTrack,
} from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import type { ChecklistStatus, MyChecklistSort } from "@/lib/list-specs";
import { pickMentions, taggerOf } from "@/lib/mention-store";
import type { MentionPick } from "@/lib/mentions";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { instructorPool, scheduleBootcamp } from "@/lib/scheduler/schedule";
import { TRACK_LABELS, trackDays } from "@/lib/scheduler/timeline";

export type ChecklistItemRow = {
  id: string;
  track: ChecklistTrack;
  day: number;
  name: string;
  /** Null when nobody owns it. */
  ownerEmail: string | null;
  ownerName: string;
  done: boolean;
  doneAt: Date | null;
  doneByName: string;
  createdBy: string | null;
  createdByName: string;
  createdByEmail: string;
  createdAt: Date;
  /** Whom its name tags with "@". */
  mentions: MentionPick[];
};

/** One track-day's items, done and to do. */
export type ChecklistDayCount = { track: ChecklistTrack; day: number; total: number; done: number };

const t = scheduleChecklistItems;

const COLUMNS = {
  id: t.id,
  track: t.track,
  day: t.day,
  name: t.name,
  ownerEmail: t.ownerEmail,
  ownerName: t.ownerName,
  done: sql<boolean>`${t.doneAt} is not null`,
  doneAt: t.doneAt,
  doneByName: t.doneByName,
  createdBy: t.createdBy,
  createdByName: t.createdByName,
  createdByEmail: t.createdByEmail,
  createdAt: t.createdAt,
  mentions: sql<MentionPick[]>`coalesce((
    select json_agg(json_build_object('email', m.email, 'fullName', m.full_name) order by m.full_name, m.email)
    from ${mentions} m where m.checklist_item_id = ${t}.id
  ), '[]'::json)`,
};

export const checklistTrackSchema = z.enum(CHECKLIST_TRACKS);
export const checklistDaySchema = z.coerce.number().int().min(1).max(30);

/** "Bootcamp, Day 2", for the audit trail and the inbox. */
export function checklistDayLabel(track: ChecklistTrack, day: number): string {
  return `${TRACK_LABELS[track]}, Day ${day}`;
}

/** How many items each track-day has, and how many are done; days with none are absent. */
export async function checklistCounts(bootcampId: string): Promise<ChecklistDayCount[]> {
  // At most four tracks of thirty days: 120 rows, all of them needed to label the board.
  return db
    .select({
      track: t.track,
      day: t.day,
      total: sql<number>`count(*)::int`,
      done: sql<number>`(count(*) filter (where ${t.doneAt} is not null))::int`,
    })
    .from(t)
    .where(eq(t.bootcampId, bootcampId))
    .groupBy(t.track, t.day)
    .orderBy(t.track, t.day);
}

/** One track-day's items, oldest first. */
export async function listDayItems(bootcampId: string, track: ChecklistTrack, day: number): Promise<ChecklistItemRow[]> {
  return db
    .select(COLUMNS)
    .from(t)
    .where(and(eq(t.bootcampId, bootcampId), eq(t.track, track), eq(t.day, day)))
    .orderBy(t.createdAt, t.id)
    .limit(CHECKLIST_LIMITS.itemsPerDay);
}

export const checklistItemSchema = z.object({
  name: z.string().trim().min(1).max(CHECKLIST_LIMITS.name),
  /** An administrator or guest judge of the bootcamp; blank or absent for nobody. */
  ownerEmail: z.string().trim().toLowerCase().max(320).nullish(),
  /** The emails of the people its name tags. */
  mentions: z.array(z.string().trim().toLowerCase().max(320)).max(SCHEDULE_LIMITS.mentions).optional(),
});

export type ChecklistError = "not_found" | "no_day" | "full" | "not_instructor" | "not_owner";

export const CHECKLIST_STATUS_FOR: Record<ChecklistError, number> = {
  not_found: 404,
  no_day: 400,
  full: 409,
  not_instructor: 400,
  not_owner: 403,
};

type Result<T> = { ok: true; value: T } | { ok: false; error: ChecklistError; email?: string };

/** Adds an item to one track-day, recording who wrote it and whom it tags. */
export async function addChecklistItem(
  actorId: string,
  bootcampId: string,
  track: ChecklistTrack,
  day: number,
  input: z.infer<typeof checklistItemSchema>,
): Promise<Result<ChecklistItemRow>> {
  const bootcamp = await scheduleBootcamp(bootcampId);
  if (!bootcamp) return { ok: false, error: "not_found" };
  noteAudit({ target: bootcampId, targetLabel: `${checklistDayLabel(track, day)}: ${input.name.slice(0, 80)}` });
  if (day > (trackDays(track, bootcamp) ?? 0)) return { ok: false, error: "no_day" };

  const pool = input.ownerEmail || input.mentions?.length ? await instructorPool(bootcampId) : [];
  let owner: { email: string; fullName: string } | null = null;
  if (input.ownerEmail) {
    owner = pool.find((i) => i.email === input.ownerEmail) ?? null;
    if (!owner) return { ok: false, error: "not_instructor", email: input.ownerEmail };
  }
  const picked = pickMentions(pool, input.mentions);
  if (!picked.ok) return { ok: false, error: "not_instructor", email: picked.email };

  const tagger = await taggerOf(actorId);
  return db.transaction(async (tx) => {
    // Held until commit, so two adds at once cannot both take the last place.
    await tx.select({ id: bootcamps.id }).from(bootcamps).where(eq(bootcamps.id, bootcampId)).for("update");
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(t)
      .where(and(eq(t.bootcampId, bootcampId), eq(t.track, track), eq(t.day, day)));
    if ((count?.n ?? 0) >= CHECKLIST_LIMITS.itemsPerDay) return { ok: false, error: "full" } as const;

    const [row] = await tx
      .insert(t)
      .values({
        bootcampId,
        track,
        day,
        name: input.name,
        ownerEmail: owner?.email ?? null,
        ownerName: owner?.fullName ?? "",
        createdBy: actorId,
        createdByName: tagger.taggedByName,
        createdByEmail: tagger.taggedByEmail,
      })
      .returning({ id: t.id, createdAt: t.createdAt });
    if (picked.tagged.length > 0) {
      await tx.insert(mentions).values(
        picked.tagged.map((m) => ({
          checklistItemId: row!.id,
          bootcampId,
          email: m.email,
          fullName: m.fullName,
          ...tagger,
          createdAt: row!.createdAt,
        })),
      );
    }
    const [full] = await tx.select(COLUMNS).from(t).where(eq(t.id, row!.id));
    noteAudit({ target: row!.id });
    return { ok: true, value: full! } as const;
  });
}

/** A change to an item: a field left out stays as it is; `mentions` goes with `name`. */
export const checklistEditSchema = z.object({
  name: checklistItemSchema.shape.name.optional(),
  /** Null or blank for nobody. */
  ownerEmail: checklistItemSchema.shape.ownerEmail,
  mentions: checklistItemSchema.shape.mentions,
});

/**
 * Changes an item's name, its owner, or both. A new name brings the tags it
 * makes: anyone it no longer tags drops out of it, and anyone newly tagged
 * finds it in their inbox. Whether it is done is left alone.
 */
export async function editChecklistItem(
  actorId: string,
  bootcampId: string,
  itemId: string,
  input: z.infer<typeof checklistEditSchema>,
): Promise<Result<ChecklistItemRow>> {
  const [item] = await db
    .select({ name: t.name, track: t.track, day: t.day })
    .from(t)
    .where(and(eq(t.id, itemId), eq(t.bootcampId, bootcampId)));
  if (!item) return { ok: false, error: "not_found" };
  noteAudit({ target: itemId, targetLabel: `${checklistDayLabel(item.track, item.day)}: ${(input.name ?? item.name).slice(0, 80)}` });

  const pool = input.ownerEmail || input.mentions?.length ? await instructorPool(bootcampId) : [];
  let owner: { email: string; fullName: string } | null | undefined;
  if (input.ownerEmail !== undefined) {
    owner = input.ownerEmail ? (pool.find((i) => i.email === input.ownerEmail) ?? null) : null;
    if (input.ownerEmail && !owner) return { ok: false, error: "not_instructor", email: input.ownerEmail };
  }
  const picked = pickMentions(pool, input.mentions);
  if (!picked.ok) return { ok: false, error: "not_instructor", email: picked.email };

  const tagger = input.name !== undefined ? await taggerOf(actorId) : null;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(t)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(owner !== undefined && { ownerEmail: owner?.email ?? null, ownerName: owner?.fullName ?? "" }),
      })
      .where(eq(t.id, itemId))
      .returning({ id: t.id });
    if (!row) return { ok: false, error: "not_found" } as const;

    if (tagger) {
      // Tags it still makes keep when they were first made.
      const have = await tx.select({ id: mentions.id, email: mentions.email }).from(mentions).where(eq(mentions.checklistItemId, itemId));
      const want = new Set(picked.tagged.map((m) => m.email));
      const gone = have.filter((m) => !want.has(m.email)).map((m) => m.id);
      if (gone.length > 0) await tx.delete(mentions).where(inArray(mentions.id, gone));
      const added = picked.tagged.filter((m) => !have.some((h) => h.email === m.email));
      if (added.length > 0) {
        await tx.insert(mentions).values(added.map((m) => ({ checklistItemId: itemId, bootcampId, email: m.email, fullName: m.fullName, ...tagger })));
      }
    }
    const [full] = await tx.select(COLUMNS).from(t).where(eq(t.id, itemId));
    return { ok: true, value: full! } as const;
  });
}

/** Who is ticking an item: any Training administrator, or the person who owns it. */
export type Ticker = { id: string; email: string | null; canManage: boolean };

/** Ticks an item done, or puts it back to do. */
export async function setChecklistItemDone(
  actor: Ticker,
  bootcampId: string,
  itemId: string,
  done: boolean,
): Promise<Result<ChecklistItemRow>> {
  const [item] = await db
    .select({ name: t.name, ownerEmail: t.ownerEmail, track: t.track, day: t.day })
    .from(t)
    .where(and(eq(t.id, itemId), eq(t.bootcampId, bootcampId)));
  if (!item) return { ok: false, error: "not_found" };
  noteAudit({ target: itemId, targetLabel: `${checklistDayLabel(item.track, item.day)}: ${item.name.slice(0, 80)}` });
  const owns = Boolean(actor.email && item.ownerEmail === actor.email.toLowerCase());
  if (!actor.canManage && !owns) return { ok: false, error: "not_owner" };

  const [who] = done ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, actor.id)) : [];
  const [row] = await db
    .update(t)
    .set(
      done
        ? { doneAt: sql`coalesce(${t.doneAt}, now())`, doneBy: actor.id, doneByName: who?.name || who?.email || "" }
        : { doneAt: null, doneBy: null, doneByName: "" },
    )
    .where(eq(t.id, itemId))
    .returning(COLUMNS);
  return row ? { ok: true, value: row } : { ok: false, error: "not_found" };
}

export async function deleteChecklistItem(bootcampId: string, itemId: string): Promise<Result<null>> {
  const [row] = await db
    .delete(t)
    .where(and(eq(t.id, itemId), eq(t.bootcampId, bootcampId)))
    .returning({ name: t.name, track: t.track, day: t.day });
  if (!row) return { ok: false, error: "not_found" };
  noteAudit({ target: itemId, targetLabel: `${checklistDayLabel(row.track, row.day)}: ${row.name.slice(0, 80)}` });
  return { ok: true, value: null };
}

// ─── What one person owns ──────────────────────────────────────────────────

export type MyChecklistRow = ChecklistItemRow & {
  bootcampId: string;
  bootcampStartDate: string;
  /** The day it is for. */
  date: string;
};

const dayDateSql = sql<string>`to_char(${bootcamps.startDate} + (${t.day} - 1), 'YYYY-MM-DD')`;

const MY_SORT_COLUMNS = {
  date: sql`${bootcamps.startDate} + (${t.day} - 1)`,
  name: sql`lower(${t.name})`,
  createdBy: sql`lower(coalesce(nullif(${t.createdByName}, ''), ${t.createdByEmail}))`,
} as const;

/** One page of the items `email` owns, across every bootcamp; the search matches the name or who wrote it. */
export async function listMyChecklist(
  email: string | null,
  status: ChecklistStatus,
  query: ListQuery<MyChecklistSort>,
): Promise<Page<MyChecklistRow>> {
  if (!email) return { rows: [], page: query.page, hasMore: false };
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({ ...COLUMNS, bootcampId: t.bootcampId, bootcampStartDate: bootcamps.startDate, date: dayDateSql })
    .from(t)
    .innerJoin(bootcamps, eq(bootcamps.id, t.bootcampId))
    .where(
      and(
        eq(t.ownerEmail, email.toLowerCase()),
        status === "open" ? isNull(t.doneAt) : status === "done" ? isNotNull(t.doneAt) : undefined,
        searchAny(query.q, [t.name, t.createdByName, t.createdByEmail]),
      ),
    )
    .orderBy(...orderFor(MY_SORT_COLUMNS[query.sort], query.dir, t.createdAt, t.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** How many items `email` owns that are still to do, for the inbox's heading. */
export async function myOpenChecklistCount(email: string | null): Promise<number> {
  if (!email) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(t.ownerEmail, email.toLowerCase()), isNull(t.doneAt)));
  return row?.n ?? 0;
}

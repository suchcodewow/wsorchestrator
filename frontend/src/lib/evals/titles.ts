/** The Sales, Engineer and Ignored title lists, read and changed. */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  EVALS_TITLE_LIMITS,
  EVALS_TITLE_LISTS,
  evalsTitles,
  users,
  type EvalsTitleList,
} from "@/db/schema";
import { cleanTitle, titleKey } from "@/lib/evals/title-lists";
import type { TitleSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

export type TitleRow = {
  id: string;
  list: EvalsTitleList;
  title: string;
  createdAt: Date;
  addedBy: string | null;
};

const TITLE_SORT_COLUMNS = {
  title: sql`lower(${evalsTitles.title})`,
  addedBy: sql`lower(coalesce(nullif(${users.name}, ''), ${users.email}))`,
  createdAt: evalsTitles.createdAt,
} as const;

/**
 * One page of titles: one list's when `list` is given, every list's
 * otherwise. The search matches the title or who added it.
 */
export async function listTitles(
  query: ListQuery<TitleSort> & { list?: EvalsTitleList },
): Promise<Page<TitleRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: evalsTitles.id,
      list: evalsTitles.list,
      title: evalsTitles.title,
      createdAt: evalsTitles.createdAt,
      addedByName: users.name,
      addedByEmail: users.email,
    })
    .from(evalsTitles)
    .leftJoin(users, eq(users.id, evalsTitles.createdBy))
    .where(
      and(
        query.list ? eq(evalsTitles.list, query.list) : undefined,
        searchAny(query.q, [evalsTitles.title, users.name, users.email]),
      ),
    )
    .orderBy(
      ...orderFor(TITLE_SORT_COLUMNS[query.sort], query.dir, sql`lower(${evalsTitles.title})`, evalsTitles.id),
    )
    .limit(limit)
    .offset(offset);

  return toPage(
    rows.map(({ addedByName, addedByEmail, list, ...row }) => ({
      ...row,
      list: list as EvalsTitleList,
      addedBy: addedByName ?? addedByEmail,
    })),
    query.page,
  );
}

/** How many titles each list holds. */
export async function titleCounts(): Promise<Record<EvalsTitleList, number>> {
  const rows = await db
    .select({ list: evalsTitles.list, count: sql<number>`count(*)::int` })
    .from(evalsTitles)
    .groupBy(evalsTitles.list);
  const counts = Object.fromEntries(EVALS_TITLE_LISTS.map((l) => [l, 0])) as Record<EvalsTitleList, number>;
  for (const r of rows) counts[r.list as EvalsTitleList] = r.count;
  return counts;
}

/** Every listed title, keyed by `titleKey`. */
export async function titleListMap(): Promise<Map<string, EvalsTitleList>> {
  const rows = await db.select({ list: evalsTitles.list, title: evalsTitles.title }).from(evalsTitles);
  return new Map(rows.map((r) => [titleKey(r.title), r.list as EvalsTitleList]));
}

export type TitleError = "invalid" | "duplicate" | "not_found";

export const STATUS_FOR: Record<TitleError, number> = {
  invalid: 400,
  duplicate: 409,
  not_found: 404,
};

const title = z.string().max(EVALS_TITLE_LIMITS.title);

export const addTitlesSchema = z.object({
  list: z.enum(EVALS_TITLE_LISTS),
  titles: z.array(title).min(1).max(EVALS_TITLE_LIMITS.perRequest),
});

export const updateTitleSchema = z.object({
  title,
  list: z.enum(EVALS_TITLE_LISTS).optional(),
});

export type AddResult = {
  added: string[];
  /** Titles already on a list — this one or another — and left as they were. */
  existing: { title: string; list: EvalsTitleList }[];
};

/** Adds each title not already on some list; the rest are reported, not moved. */
export async function addTitles(
  actorId: string,
  list: EvalsTitleList,
  titles: string[],
): Promise<AddResult> {
  const wanted = new Map<string, string>();
  for (const t of titles.map(cleanTitle)) {
    if (t && !wanted.has(t.toLowerCase())) wanted.set(t.toLowerCase(), t);
  }
  if (wanted.size === 0) return { added: [], existing: [] };

  const current = await db.select({ list: evalsTitles.list, title: evalsTitles.title }).from(evalsTitles);
  const byKey = new Map(current.map((r) => [titleKey(r.title), r]));

  const existing: AddResult["existing"] = [];
  const fresh: string[] = [];
  for (const [key, t] of wanted) {
    const found = byKey.get(key);
    if (found) existing.push({ title: found.title, list: found.list as EvalsTitleList });
    else fresh.push(t);
  }

  // Someone else adding the same title in between loses quietly to them.
  const inserted =
    fresh.length === 0
      ? []
      : await db
          .insert(evalsTitles)
          .values(fresh.map((t) => ({ list, title: t, createdBy: actorId })))
          .onConflictDoNothing()
          .returning({ title: evalsTitles.title });

  return { added: inserted.map((r) => r.title), existing };
}

export async function updateTitle(
  id: string,
  input: z.infer<typeof updateTitleSchema>,
): Promise<{ ok: true } | { ok: false; error: TitleError; list?: EvalsTitleList }> {
  const next = cleanTitle(input.title);
  if (!next) return { ok: false, error: "invalid" };

  const [row] = await db.select().from(evalsTitles).where(eq(evalsTitles.id, id));
  if (!row) return { ok: false, error: "not_found" };

  const [clash] = await db
    .select({ id: evalsTitles.id, list: evalsTitles.list })
    .from(evalsTitles)
    .where(sql`lower(${evalsTitles.title}) = ${next.toLowerCase()} and ${evalsTitles.id} <> ${id}`);
  if (clash) return { ok: false, error: "duplicate", list: clash.list as EvalsTitleList };

  await db
    .update(evalsTitles)
    .set({ title: next, ...(input.list ? { list: input.list } : {}) })
    .where(eq(evalsTitles.id, id));
  return { ok: true };
}

export async function deleteTitle(id: string): Promise<{ ok: true } | { ok: false; error: TitleError }> {
  const deleted = await db.delete(evalsTitles).where(eq(evalsTitles.id, id)).returning({ id: evalsTitles.id });
  return deleted.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
}

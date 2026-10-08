/**
 * Mimir's content: reading it a page at a time for the library and Mimir
 * Settings, and the edits and imports Training Administrators make.
 *
 * An item's id is a stable slug, so an import updates what an earlier import
 * made rather than adding a second copy. Its kind is fixed once it exists, and
 * where it may sit is fixed by its kind: a discovery question under a
 * discovery group, a glossary term under a category, a capability under an
 * agent or nowhere, and everything else at the top.
 */

import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  MIMIR_ITEM_LIMITS,
  MIMIR_KINDS,
  mimirItems,
  type MimirAttrs,
  type MimirKind,
  type MimirSection,
} from "@/db/schema";
import type { MimirItemSort } from "@/lib/list-specs";
import { ITEM_ID, OPTIONAL_PARENT, REQUIRED_PARENT, slugFor, type ItemFilter } from "@/lib/mimir/kinds";
import { PAGE_SIZE, pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { isForeignKeyViolation } from "@/lib/scheduler/pg-errors";

const L = MIMIR_ITEM_LIMITS;

export type ItemSummary = {
  id: string;
  kind: MimirKind;
  parentId: string | null;
  position: number;
  title: string;
  emoji: string;
  color: string;
  summary: string;
  attrs: MimirAttrs;
  updatedAt: Date;
};

export type ItemDetail = ItemSummary & {
  body: string;
  sections: MimirSection[];
  createdAt: Date;
};

const summaryColumns = {
  id: mimirItems.id,
  kind: mimirItems.kind,
  parentId: mimirItems.parentId,
  position: mimirItems.position,
  title: mimirItems.title,
  emoji: mimirItems.emoji,
  color: mimirItems.color,
  summary: mimirItems.summary,
  attrs: mimirItems.attrs,
  updatedAt: mimirItems.updatedAt,
};

const SORT_COLUMNS = {
  position: mimirItems.position,
  title: sql`lower(${mimirItems.title})`,
  kind: mimirItems.kind,
  updatedAt: mimirItems.updatedAt,
} as const;

/** One page of items; the search matches the title, the summary and the body. */
export async function listItems(query: ListQuery<MimirItemSort>, filter: ItemFilter = {}): Promise<Page<ItemSummary>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select(summaryColumns)
    .from(mimirItems)
    .where(
      and(
        searchAny(query.q, [mimirItems.title, mimirItems.summary, mimirItems.body]),
        filter.kind ? eq(mimirItems.kind, filter.kind) : undefined,
        filter.parentId === null
          ? isNull(mimirItems.parentId)
          : filter.parentId
            ? eq(mimirItems.parentId, filter.parentId)
            : undefined,
        filter.cat ? sql`(${mimirItems.attrs} -> 'cats') ? ${filter.cat}` : undefined,
        filter.featured ? sql`(${mimirItems.attrs} ->> 'featured') = 'true'` : undefined,
      ),
    )
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`lower(${mimirItems.title})`, mimirItems.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** How many items there are, of one kind or in all. */
export async function itemCount(kind?: MimirKind): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mimirItems)
    .where(kind ? eq(mimirItems.kind, kind) : undefined);
  return row?.count ?? 0;
}

/** One item in full, with what it holds (at most a page) and what holds it. */
export async function getItem(
  id: string,
): Promise<{ item: ItemDetail; parent: ItemSummary | null; children: ItemSummary[] } | null> {
  const [item] = await db
    .select({ ...summaryColumns, body: mimirItems.body, sections: mimirItems.sections, createdAt: mimirItems.createdAt })
    .from(mimirItems)
    .where(eq(mimirItems.id, id));
  if (!item) return null;

  const [parent, children] = await Promise.all([
    item.parentId
      ? db.select(summaryColumns).from(mimirItems).where(eq(mimirItems.id, item.parentId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select(summaryColumns)
      .from(mimirItems)
      .where(eq(mimirItems.parentId, id))
      .orderBy(asc(mimirItems.position), sql`lower(${mimirItems.title})`, asc(mimirItems.id))
      .limit(PAGE_SIZE),
  ]);
  return { item, parent, children };
}

/** A glossary term as text elsewhere links to it: its name, definition, and the forms that match it. */
export type GlossaryEntry = { id: string; title: string; definition: string; aliases: string[] };

/** Every glossary term, for linking the words in other text to them, read a page at a time. */
export async function glossaryIndex(): Promise<GlossaryEntry[]> {
  const all: GlossaryEntry[] = [];
  for (let page = 1; ; page++) {
    const { limit, offset } = pageWindow(page);
    const rows = await db
      .select({ id: mimirItems.id, title: mimirItems.title, definition: mimirItems.summary, attrs: mimirItems.attrs })
      .from(mimirItems)
      .where(eq(mimirItems.kind, "term"))
      .orderBy(asc(mimirItems.id))
      .limit(limit)
      .offset(offset);
    for (const r of rows.slice(0, PAGE_SIZE)) {
      all.push({ id: r.id, title: r.title, definition: r.definition, aliases: r.attrs.aliases ?? [] });
    }
    if (rows.length <= PAGE_SIZE) return all;
  }
}

/* ------------------------------------------------------------------ */
/* Changing it                                                         */
/* ------------------------------------------------------------------ */

const attr = z.string().trim().max(L.attr);

const attrsSchema = z
  .object({
    badge: attr,
    role: attr,
    tag: attr,
    buyer: attr,
    scenario: attr,
    salesAngle: attr,
    strength: attr,
    advantages: attr,
    watchOut: attr,
    headline: attr,
    url: attr,
    loop: attr,
    group: attr,
    why: attr,
    followUp: attr,
    seeAlso: attr,
    forKind: attr,
    number: z.number().int().min(0).max(10_000),
    featured: z.boolean(),
    cats: z.array(z.string().trim().min(1).max(60)).max(L.listEntries),
    mods: z.array(z.string().trim().min(1).max(60)).max(L.listEntries),
    aliases: z.array(z.string().trim().min(1).max(80)).max(L.listEntries),
  })
  .partial()
  .strict();

export const itemSchema = z.object({
  /** Kept on an update, where the path names the item. On a create or an import, made from the title when left out. */
  id: z.string().trim().min(1).max(L.id).regex(ITEM_ID).optional(),
  kind: z.enum(MIMIR_KINDS),
  parentId: z.string().trim().min(1).max(L.id).nullable().default(null),
  position: z.number().int().min(0).max(100_000).default(0),
  title: z.string().trim().min(1).max(L.title),
  emoji: z.string().trim().max(L.emoji).default(""),
  color: z
    .string()
    .trim()
    .regex(/^(#[0-9a-fA-F]{6})?$/)
    .default(""),
  summary: z.string().trim().max(L.summary).default(""),
  body: z.string().max(L.body).default(""),
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(L.sectionTitle),
        content: z.string().max(L.sectionContent),
      }),
    )
    .max(L.sections)
    .default([]),
  attrs: attrsSchema.default({}),
});

export type ItemInput = z.infer<typeof itemSchema>;

/** An import: the items in an order that puts every parent before what it holds. */
export const MIMIR_IMPORT_MAX = 2000;
export const importSchema = z.object({ items: z.array(itemSchema).min(1).max(MIMIR_IMPORT_MAX) });

export type ItemError = "invalid" | "not_found" | "bad_parent" | "kind_fixed" | "has_children" | "taken";

export const ITEM_STATUS_FOR: Record<ItemError, number> = {
  invalid: 400,
  not_found: 404,
  bad_parent: 400,
  kind_fixed: 409,
  has_children: 409,
  taken: 409,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Whether an item of `kind` may sit under `parentKind` (undefined: no parent). */
function parentAllowed(kind: MimirKind, parentKind: MimirKind | undefined): boolean {
  const required = REQUIRED_PARENT[kind];
  if (required) return parentKind === required;
  if (parentKind === undefined) return true;
  return OPTIONAL_PARENT[kind] === parentKind;
}

/** The kinds of the items `ids` name, and whether each sits under another. */
async function parentsOf(tx: Tx, ids: string[]): Promise<Map<string, { kind: MimirKind; nested: boolean }>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: mimirItems.id, kind: mimirItems.kind, parentId: mimirItems.parentId })
    .from(mimirItems)
    .where(inArray(mimirItems.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, { kind: r.kind, nested: r.parentId !== null }]));
}

function values(actorId: string, input: ItemInput) {
  return {
    kind: input.kind,
    parentId: input.parentId,
    position: input.position,
    title: input.title,
    emoji: input.emoji,
    color: input.color.toLowerCase(),
    summary: input.summary,
    body: input.body,
    sections: input.sections,
    attrs: input.attrs,
    updatedBy: actorId,
    updatedAt: new Date(),
  };
}

type Saved = { ok: true; id: string; title: string } | { ok: false; error: ItemError };

async function checkParent(tx: Tx, kind: MimirKind, parentId: string | null, selfId?: string): Promise<boolean> {
  if (parentId === null) return parentAllowed(kind, undefined);
  if (parentId === selfId) return false;
  const parent = (await parentsOf(tx, [parentId])).get(parentId);
  // Nothing sits under an item that itself sits under another.
  return Boolean(parent && !parent.nested && parentAllowed(kind, parent.kind));
}

/** Makes an item. Without an id one is made from the title, numbered past any already taken. */
export async function createItem(actorId: string, input: ItemInput): Promise<Saved> {
  return db.transaction(async (tx) => {
    if (!(await checkParent(tx, input.kind, input.parentId))) return { ok: false as const, error: "bad_parent" as const };

    let id = input.id;
    if (id) {
      const [taken] = await tx.select({ id: mimirItems.id }).from(mimirItems).where(eq(mimirItems.id, id));
      if (taken) return { ok: false as const, error: "taken" as const };
    } else {
      const base = slugFor(input.title);
      const like = await tx
        .select({ id: mimirItems.id })
        .from(mimirItems)
        .where(sql`${mimirItems.id} = ${base} or ${mimirItems.id} like ${`${base}-%`}`);
      const used = new Set(like.map((r) => r.id));
      id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    }

    const [row] = await tx
      .insert(mimirItems)
      .values({ id, ...values(actorId, input) })
      .returning({ id: mimirItems.id, title: mimirItems.title });
    return { ok: true as const, id: row!.id, title: row!.title };
  });
}

/** Replaces an item's fields. Its kind cannot change, and no item can be made its own parent. */
export async function updateItem(actorId: string, id: string, input: ItemInput): Promise<Saved> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ kind: mimirItems.kind })
      .from(mimirItems)
      .where(eq(mimirItems.id, id))
      .for("update");
    if (!current) return { ok: false as const, error: "not_found" as const };
    if (current.kind !== input.kind) return { ok: false as const, error: "kind_fixed" as const };
    if (!(await checkParent(tx, input.kind, input.parentId, id))) {
      return { ok: false as const, error: "bad_parent" as const };
    }
    if (input.parentId !== null) {
      const [child] = await tx.select({ id: mimirItems.id }).from(mimirItems).where(eq(mimirItems.parentId, id)).limit(1);
      if (child) return { ok: false as const, error: "bad_parent" as const };
    }

    const [row] = await tx
      .update(mimirItems)
      .set(values(actorId, input))
      .where(eq(mimirItems.id, id))
      .returning({ id: mimirItems.id, title: mimirItems.title });
    return { ok: true as const, id: row!.id, title: row!.title };
  });
}

/**
 * Removes an item, and with it everyone's progress on it and their
 * conversations about it. One that holds others is refused until they go.
 */
export async function deleteItem(id: string): Promise<{ ok: true; title: string } | { ok: false; error: ItemError }> {
  const [child] = await db.select({ id: mimirItems.id }).from(mimirItems).where(eq(mimirItems.parentId, id)).limit(1);
  if (child) return { ok: false, error: "has_children" };
  try {
    const [deleted] = await db.delete(mimirItems).where(eq(mimirItems.id, id)).returning({ title: mimirItems.title });
    return deleted ? { ok: true, title: deleted.title } : { ok: false, error: "not_found" };
  } catch (err) {
    // Something was put under it in between: the foreign key refuses it.
    if (isForeignKeyViolation(err)) return { ok: false, error: "has_children" };
    throw err;
  }
}

export type ImportResult =
  | { ok: true; created: number; updated: number }
  | { ok: false; error: ItemError; index: number; id: string };

/**
 * Writes every item in one transaction, or none. An item whose id exists is
 * updated in place, so its progress and conversations stay; one that does not
 * is made. Items the import leaves out are left alone.
 */
export async function importItems(actorId: string, inputs: ItemInput[]): Promise<ImportResult> {
  const withIds = inputs.map((input) => ({ ...input, id: input.id ?? slugFor(input.title) }));
  const seen = new Set<string>();
  for (const [index, input] of withIds.entries()) {
    if (seen.has(input.id)) return { ok: false, error: "taken", index, id: input.id };
    seen.add(input.id);
  }

  return db.transaction(async (tx) => {
    const existing = await parentsOf(tx, [...withIds.map((i) => i.id), ...withIds.flatMap((i) => i.parentId ?? [])]);

    // Every item is checked before any is written: a transaction that returns
    // rather than throws still commits.
    const known = new Map(existing);
    for (const [index, input] of withIds.entries()) {
      const before = existing.get(input.id);
      if (before && before.kind !== input.kind) {
        return { ok: false as const, error: "kind_fixed" as const, index, id: input.id };
      }
      const parent = input.parentId === null ? undefined : known.get(input.parentId);
      const fits =
        input.parentId === null
          ? parentAllowed(input.kind, undefined)
          : Boolean(parent && !parent.nested && input.parentId !== input.id && parentAllowed(input.kind, parent.kind));
      if (!fits) return { ok: false as const, error: "bad_parent" as const, index, id: input.id };
      known.set(input.id, { kind: input.kind, nested: input.parentId !== null });
    }

    let created = 0;
    let updated = 0;
    for (const input of withIds) {
      const set = values(actorId, input);
      const [row] = await tx
        .insert(mimirItems)
        .values({ id: input.id, ...set })
        .onConflictDoUpdate({ target: mimirItems.id, set })
        .returning({ inserted: sql<boolean>`xmax = 0` });
      if (row?.inserted) created++;
      else updated++;
    }
    return { ok: true as const, created, updated };
  });
}

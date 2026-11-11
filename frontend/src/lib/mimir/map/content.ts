/**
 * The concept map's content in the database: its structure as versions, the
 * highest of them live, and each concept's videos as rows of their own. Read
 * back together and through the same schema, so a hand-edited or stale row
 * can never reach the page or the coach as something it is not.
 *
 * Every change to the structure adds a version, under one lock, as the next
 * number after the live one. An edit names the version it was made from and
 * is refused when that is no longer the live one, so a change made meanwhile
 * is never overwritten. Videos are Mimir Studio's, and an edit never touches
 * them.
 */

import "server-only";

import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { mimirConceptVideos, mimirMapVersions, users, type MimirMapSource } from "@/db/schema";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import type { MapVersionSort } from "@/lib/list-specs";
import { MAP_SUMMARY_MAX, mapContentSchema, videoRows, withoutVideos, withVideos, type MapContent, type VideoRow } from "./schema";

export type StoredMap = { content: MapContent; importedAt: Date; version: number };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Held by every writer of a version, so two cannot both take the next number. */
const LOCK = sql`select pg_advisory_xact_lock(hashtext('mimir_map_versions'))`;

async function videosFor(conceptIds: string[]): Promise<VideoRow[]> {
  if (conceptIds.length === 0) return [];
  const rows = await db.select().from(mimirConceptVideos).where(inArray(mimirConceptVideos.conceptId, conceptIds));
  return rows.map((r) => ({
    conceptId: r.conceptId,
    language: r.language,
    object: r.object,
    seconds: r.seconds,
    transcript: r.transcript,
  }));
}

const conceptIdsOf = (structure: unknown): string[] =>
  ((structure as { concepts?: { id?: unknown }[] } | null)?.concepts ?? []).flatMap((c) => (typeof c.id === "string" ? [c.id] : []));

/** The live map with its videos, or null before there is one (or if what is stored no longer fits the schema). */
export async function getMap(): Promise<StoredMap | null> {
  const [row] = await db.select().from(mimirMapVersions).orderBy(desc(mimirMapVersions.version)).limit(1);
  if (!row) return null;
  const parsed = mapContentSchema.safeParse(withVideos(row.content, await videosFor(conceptIdsOf(row.content))));
  if (!parsed.success) {
    console.error(`mimir: map version ${row.version} no longer fits its schema`, parsed.error.issues[0]);
    return null;
  }
  return { content: parsed.data, importedAt: row.createdAt, version: row.version };
}

async function liveVersion(tx: Tx): Promise<number> {
  const [row] = await tx.select({ version: sql<number>`coalesce(max(${mimirMapVersions.version}), 0)::int` }).from(mimirMapVersions);
  return row?.version ?? 0;
}

async function insertVersion(tx: Tx, version: number, content: MapContent, source: MimirMapSource, summary: string, userId: string | null) {
  await tx
    .insert(mimirMapVersions)
    .values({ version, content: withoutVideos(content), source, summary: summary.slice(0, MAP_SUMMARY_MAX), createdBy: userId });
}

/**
 * Adds `content` as the live map, whatever is live now: for an import or a
 * published deck, which replace the map rather than edit it. Returns its
 * version. `tx` lets a caller do more in the same transaction.
 */
export async function replaceMap(
  userId: string | null,
  content: MapContent,
  source: Extract<MimirMapSource, "import" | "deck">,
  summary: string,
  tx?: Tx,
): Promise<number> {
  const run = async (t: Tx) => {
    await t.execute(LOCK);
    const version = (await liveVersion(t)) + 1;
    await insertVersion(t, version, content, source, summary, userId);
    return version;
  };
  return tx ? run(tx) : db.transaction(run);
}

/**
 * Replaces the map from an imported file, which is the whole of it, videos
 * and all: each concept in it gets the videos the file gives it, or none.
 * Each person's progress is keyed by concept id, so it carries over to any
 * concept the new map keeps.
 */
export async function importMap(userId: string, content: MapContent, summary = "Imported from a file."): Promise<number> {
  return db.transaction(async (tx) => {
    const version = await replaceMap(userId, content, "import", summary, tx);
    const ids = content.concepts.map((c) => c.id);
    await tx.delete(mimirConceptVideos).where(inArray(mimirConceptVideos.conceptId, ids));
    const rows = videoRows(content);
    if (rows.length) await tx.insert(mimirConceptVideos).values(rows);
    return version;
  });
}

export type EditOutcome = { ok: true; version: number } | { ok: false; error: "conflict"; live: number };

/**
 * An edit to the map's structure, made from version `base`: added as the next
 * version if `base` is still the live one, refused as a conflict otherwise.
 * Any videos in `content` are ignored; the concepts keep the ones they have.
 */
export async function editMap(
  userId: string,
  base: number,
  content: MapContent,
  summary: string,
  source: Extract<MimirMapSource, "edit" | "restore"> = "edit",
): Promise<EditOutcome> {
  return db.transaction(async (tx) => {
    await tx.execute(LOCK);
    const live = await liveVersion(tx);
    if (live !== base) return { ok: false as const, error: "conflict" as const, live };
    await insertVersion(tx, live + 1, content, source, summary, userId);
    return { ok: true as const, version: live + 1 };
  });
}

export type MapVersionRow = {
  version: number;
  source: MimirMapSource;
  summary: string;
  createdAt: string;
  createdBy: { id: string; name: string | null; email: string | null } | null;
  live: boolean;
};

const VERSION_SORT = {
  version: mimirMapVersions.version,
  createdAt: mimirMapVersions.createdAt,
};

/** The map's versions a page at a time, the newest first: what each was, and who made it; searched by what changed. */
export async function listMapVersions(query: ListQuery<MapVersionSort>): Promise<Page<MapVersionRow>> {
  const { limit, offset } = pageWindow(query.page);
  const [live, rows] = await Promise.all([
    db.select({ v: sql<number>`coalesce(max(${mimirMapVersions.version}), 0)::int` }).from(mimirMapVersions),
    db
      .select({
        version: mimirMapVersions.version,
        source: mimirMapVersions.source,
        summary: mimirMapVersions.summary,
        createdAt: mimirMapVersions.createdAt,
        userId: users.id,
        name: users.name,
        email: users.email,
      })
      .from(mimirMapVersions)
      .leftJoin(users, eq(users.id, mimirMapVersions.createdBy))
      .where(searchAny(query.q, [mimirMapVersions.summary]))
      .orderBy(...orderFor(VERSION_SORT[query.sort], query.dir, desc(mimirMapVersions.version)))
      .limit(limit)
      .offset(offset),
  ]);
  const liveVersionNumber = live[0]?.v ?? 0;
  return toPage(
    rows.map((r) => ({
      version: r.version,
      source: r.source,
      summary: r.summary,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.userId ? { id: r.userId, name: r.name, email: r.email } : null,
      live: r.version === liveVersionNumber,
    })),
    query.page,
  );
}

/** One version's structure, without videos; null if there is no such version or it no longer fits the schema. */
export async function getMapVersion(version: number): Promise<{ content: MapContent; createdAt: Date; source: MimirMapSource } | null> {
  if (!Number.isInteger(version) || version < 1) return null;
  const [row] = await db.select().from(mimirMapVersions).where(eq(mimirMapVersions.version, version));
  if (!row) return null;
  const parsed = mapContentSchema.safeParse(row.content);
  return parsed.success ? { content: parsed.data, createdAt: row.createdAt, source: row.source } : null;
}

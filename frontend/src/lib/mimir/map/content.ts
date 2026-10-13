/**
 * The concept map's content in the database: one row, replaced whole by each
 * import and read back through the same schema, so a hand-edited or stale row
 * can never reach the page or the coach as something it is not.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mimirMap } from "@/db/schema";
import { MAP_ID, mapContentSchema, type MapContent } from "./schema";

export type StoredMap = { content: MapContent; importedAt: Date };

/** The imported map, or null before there is one (or if what is stored no longer fits the schema). */
export async function getMap(): Promise<StoredMap | null> {
  const [row] = await db.select().from(mimirMap).where(eq(mimirMap.id, MAP_ID));
  if (!row) return null;
  const parsed = mapContentSchema.safeParse(row.content);
  if (!parsed.success) {
    console.error("mimir: the stored map no longer fits its schema", parsed.error.issues[0]);
    return null;
  }
  return { content: parsed.data, importedAt: row.importedAt };
}

/** Replaces the map. Each person's progress is keyed by concept id, so it carries over to any concept the new map keeps. */
export async function importMap(userId: string, content: MapContent): Promise<void> {
  const now = new Date();
  await db
    .insert(mimirMap)
    .values({ id: MAP_ID, content, importedBy: userId, importedAt: now })
    .onConflictDoUpdate({ target: mimirMap.id, set: { content, importedBy: userId, importedAt: now } });
}

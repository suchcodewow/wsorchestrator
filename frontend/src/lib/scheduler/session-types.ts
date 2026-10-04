/**
 * The quick starts for a new session, set up in Scheduler settings → Session
 * types. Picking one fills in a session's kind, name, icon, color, length and
 * description; after that they are the session's own, so changing or
 * removing a type changes no session.
 */

import "server-only";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { SCHEDULE_LIMITS, SESSION_COLORS, SESSION_KINDS, sessionTypes, type SessionColor, type SessionKind } from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import type { SessionTypeSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { isUniqueViolation } from "@/lib/scheduler/pg-errors";

export type SessionTypeRow = {
  id: string;
  name: string;
  kind: SessionKind;
  emoji: string;
  color: SessionColor;
  minutes: number;
  description: string;
  position: number;
};

const COLUMNS = {
  id: sessionTypes.id,
  name: sessionTypes.name,
  kind: sessionTypes.kind,
  emoji: sessionTypes.emoji,
  color: sessionTypes.color,
  minutes: sessionTypes.minutes,
  description: sessionTypes.description,
  position: sessionTypes.position,
};

const SORT_COLUMNS = {
  position: sessionTypes.position,
  name: sql`lower(${sessionTypes.name})`,
  kind: sessionTypes.kind,
  minutes: sessionTypes.minutes,
} as const;

/** One page of session types; the search matches the name or the description. */
export async function listSessionTypes(query: ListQuery<SessionTypeSort>): Promise<Page<SessionTypeRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select(COLUMNS)
    .from(sessionTypes)
    .where(searchAny(query.q, [sessionTypes.name, sessionTypes.description]))
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`lower(${sessionTypes.name})`, sessionTypes.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** Every type in order, for the session dialog. There are at most `SCHEDULE_LIMITS.types`. */
export async function allSessionTypes(): Promise<SessionTypeRow[]> {
  return db
    .select(COLUMNS)
    .from(sessionTypes)
    .orderBy(sessionTypes.position, sql`lower(${sessionTypes.name})`)
    .limit(SCHEDULE_LIMITS.types);
}

const minutes = z
  .number()
  .int()
  .min(SCHEDULE_LIMITS.slot)
  .max(SCHEDULE_LIMITS.maxMinutes)
  .refine((m) => m % SCHEDULE_LIMITS.slot === 0, "not a whole number of quarter hours");

/** The fields every session and session type share. */
export const sessionLookSchema = {
  kind: z.enum(SESSION_KINDS),
  name: z.string().trim().min(1).max(SCHEDULE_LIMITS.name),
  emoji: z.string().trim().max(SCHEDULE_LIMITS.emoji),
  color: z.enum(SESSION_COLORS),
  minutes,
  description: z.string().max(SCHEDULE_LIMITS.description),
};

export const sessionTypeInputSchema = z.object({
  ...sessionLookSchema,
  emoji: sessionLookSchema.emoji.default(""),
  color: sessionLookSchema.color.default("slate"),
  description: sessionLookSchema.description.default(""),
  /** Where the session dialog lists it; lower first. */
  position: z.number().int().min(0).max(1000).optional(),
});

export const sessionTypePatchSchema = z.object(sessionLookSchema).extend({ position: z.number().int().min(0).max(1000) }).partial();

export type SessionTypeError = "invalid" | "duplicate" | "too_many" | "not_found";

export const SESSION_TYPE_STATUS_FOR: Record<SessionTypeError, number> = {
  invalid: 400,
  duplicate: 409,
  too_many: 409,
  not_found: 404,
};

export async function createSessionType(
  actorId: string,
  input: z.infer<typeof sessionTypeInputSchema>,
): Promise<{ ok: true; type: SessionTypeRow } | { ok: false; error: SessionTypeError }> {
  const [{ count, last }] = await db
    .select({ count: sql<number>`count(*)::int`, last: sql<number>`coalesce(max(${sessionTypes.position}), -1)::int` })
    .from(sessionTypes) as [{ count: number; last: number }];
  if (count >= SCHEDULE_LIMITS.types) return { ok: false, error: "too_many" };
  try {
    const [made] = await db
      .insert(sessionTypes)
      .values({ ...input, position: input.position ?? last + 1, createdBy: actorId })
      .returning(COLUMNS);
    noteAudit({ target: made!.id, targetLabel: made!.name });
    return { ok: true, type: made! };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate" };
    throw err;
  }
}

export async function updateSessionType(
  id: string,
  patch: z.infer<typeof sessionTypePatchSchema>,
): Promise<{ ok: true; type: SessionTypeRow } | { ok: false; error: SessionTypeError }> {
  try {
    const [row] = await db
      .update(sessionTypes)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(sessionTypes.id, id))
      .returning(COLUMNS);
    if (!row) return { ok: false, error: "not_found" };
    noteAudit({ target: id, targetLabel: row.name });
    return { ok: true, type: row };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate" };
    throw err;
  }
}

/** Removes a type. Sessions started from it keep everything they took from it. */
export async function deleteSessionType(id: string): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const [deleted] = await db.delete(sessionTypes).where(eq(sessionTypes.id, id)).returning({ name: sessionTypes.name });
  if (!deleted) return { ok: false, error: "not_found" };
  noteAudit({ target: id, targetLabel: deleted.name });
  return { ok: true };
}

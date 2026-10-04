/**
 * The places bootcamps are held, and their rooms, set up in Scheduler
 * settings → Facilities. A bootcamp names one; its sessions pick rooms from
 * it. Removing a room takes it off every session that used it, and removing
 * a facility takes it off every bootcamp held there.
 */

import "server-only";

import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { FACILITY_LIMITS, bootcamps, facilities, facilityRooms } from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import type { FacilitySort } from "@/lib/list-specs";
import { PAGE_SIZE, pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { isUniqueViolation } from "@/lib/scheduler/pg-errors";

export type FacilityRow = {
  id: string;
  name: string;
  rooms: number;
  /** Everyone its rooms hold together. */
  capacity: number;
  bootcamps: number;
  updatedAt: Date;
};

export type RoomRow = { id: string; name: string; capacity: number };

export type FacilityDetail = { id: string; name: string; rooms: RoomRow[] };

// Spelled out, because Drizzle leaves the table off a column in a one-table
// query, and an unqualified `id` inside these would mean the room's own.
const roomCount = sql<number>`(select count(*)::int from ${facilityRooms} r where r.facility_id = ${facilities}.id)`;
const capacity = sql<number>`(select coalesce(sum(r.capacity), 0)::int from ${facilityRooms} r where r.facility_id = ${facilities}.id)`;
const bootcampCount = sql<number>`(select count(*)::int from ${bootcamps} b where b.facility_id = ${facilities}.id)`;

const SORT_COLUMNS = {
  name: sql`lower(${facilities.name})`,
  rooms: roomCount,
  capacity,
  updatedAt: facilities.updatedAt,
} as const;

/** One page of facilities; the search matches the name or a room's name. */
export async function listFacilities(query: ListQuery<FacilitySort>): Promise<Page<FacilityRow>> {
  const { limit, offset } = pageWindow(query.page);
  const roomMatch = query.q
    ? sql`exists (select 1 from ${facilityRooms} where ${facilityRooms.facilityId} = ${facilities}.id and ${searchAny(query.q, [facilityRooms.name])})`
    : undefined;
  const rows = await db
    .select({
      id: facilities.id,
      name: facilities.name,
      rooms: roomCount,
      capacity,
      bootcamps: bootcampCount,
      updatedAt: facilities.updatedAt,
    })
    .from(facilities)
    .where(query.q ? sql`(${searchAny(query.q, [facilities.name])} or ${roomMatch})` : undefined)
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`lower(${facilities.name})`, facilities.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** Every facility by name, for the bootcamp dialog's picker. */
export async function facilityPicks(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: facilities.id, name: facilities.name })
    .from(facilities)
    .orderBy(sql`lower(${facilities.name})`, facilities.id)
    .limit(PAGE_SIZE);
}

/** A facility's rooms in their order. */
export async function roomsOf(facilityId: string): Promise<RoomRow[]> {
  return db
    .select({ id: facilityRooms.id, name: facilityRooms.name, capacity: facilityRooms.capacity })
    .from(facilityRooms)
    .where(eq(facilityRooms.facilityId, facilityId))
    .orderBy(asc(facilityRooms.position), sql`lower(${facilityRooms.name})`)
    .limit(FACILITY_LIMITS.rooms);
}

export async function getFacility(id: string): Promise<FacilityDetail | null> {
  const [row] = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(eq(facilities.id, id));
  return row ? { ...row, rooms: await roomsOf(id) } : null;
}

const name = z.string().trim().min(1).max(FACILITY_LIMITS.name);

const roomSchema = z.object({
  /** A room it has already, to keep it and the sessions that use it. Left out, the room is new. */
  id: z.string().uuid().optional(),
  name,
  capacity: z.number().int().min(1).max(FACILITY_LIMITS.capacity),
});

export const facilityInputSchema = z.object({
  name,
  /** Every room, in order; it replaces the set. A room left out is removed. */
  rooms: z.array(roomSchema).max(FACILITY_LIMITS.rooms),
});

export const facilityPatchSchema = facilityInputSchema.partial();

export type FacilityError = "invalid" | "duplicate" | "duplicate_room" | "unknown_room" | "not_found";

export const FACILITY_STATUS_FOR: Record<FacilityError, number> = {
  invalid: 400,
  duplicate: 409,
  duplicate_room: 400,
  unknown_room: 400,
  not_found: 404,
};

type Failure = { ok: false; error: FacilityError; room?: string };

/** The room named twice, ignoring case, if any. */
function repeatedRoom(rooms: readonly { name: string }[]): string | null {
  const seen = new Set<string>();
  for (const r of rooms) {
    const key = r.name.toLowerCase();
    if (seen.has(key)) return r.name;
    seen.add(key);
  }
  return null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Makes `rooms` exactly the facility's rooms, in that order. */
async function setRooms(tx: Tx, facilityId: string, rooms: z.infer<typeof roomSchema>[]): Promise<Failure | null> {
  const keep = rooms.flatMap((r) => (r.id ? [r.id] : []));
  if (keep.length > 0) {
    const mine = await tx
      .select({ id: facilityRooms.id })
      .from(facilityRooms)
      .where(and(eq(facilityRooms.facilityId, facilityId), inArray(facilityRooms.id, keep)));
    if (mine.length !== new Set(keep).size) return { ok: false, error: "unknown_room" };
  }
  await tx
    .delete(facilityRooms)
    .where(and(eq(facilityRooms.facilityId, facilityId), keep.length > 0 ? notInArray(facilityRooms.id, keep) : undefined));
  // Kept rooms are renamed in two steps, so a swap of two names never trips the unique index.
  for (const r of rooms) {
    if (r.id) await tx.update(facilityRooms).set({ name: `renaming ${r.id}` }).where(eq(facilityRooms.id, r.id));
  }
  for (const [position, r] of rooms.entries()) {
    if (r.id) {
      await tx.update(facilityRooms).set({ name: r.name, capacity: r.capacity, position }).where(eq(facilityRooms.id, r.id));
    } else {
      await tx.insert(facilityRooms).values({ facilityId, name: r.name, capacity: r.capacity, position });
    }
  }
  return null;
}

export async function createFacility(
  actorId: string,
  input: z.infer<typeof facilityInputSchema>,
): Promise<{ ok: true; id: string } | Failure> {
  const repeated = repeatedRoom(input.rooms);
  if (repeated) return { ok: false, error: "duplicate_room", room: repeated };
  if (input.rooms.some((r) => r.id)) return { ok: false, error: "unknown_room" };
  try {
    const id = await db.transaction(async (tx) => {
      const [made] = await tx
        .insert(facilities)
        .values({ name: input.name, createdBy: actorId })
        .returning({ id: facilities.id });
      await setRooms(tx, made!.id, input.rooms);
      return made!.id;
    });
    noteAudit({ target: id, targetLabel: input.name });
    return { ok: true, id };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate" };
    throw err;
  }
}

class Refused extends Error {
  constructor(readonly failure: Failure) {
    super(failure.error);
  }
}

export async function updateFacility(
  id: string,
  patch: z.infer<typeof facilityPatchSchema>,
): Promise<{ ok: true } | Failure> {
  const [before] = await db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, id));
  if (!before) return { ok: false, error: "not_found" };
  noteAudit({ target: id, targetLabel: patch.name ?? before.name });
  const repeated = patch.rooms ? repeatedRoom(patch.rooms) : null;
  if (repeated) return { ok: false, error: "duplicate_room", room: repeated };
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(facilities)
        .set({ ...(patch.name ? { name: patch.name } : {}), updatedAt: new Date() })
        .where(eq(facilities.id, id));
      if (patch.rooms) {
        const refused = await setRooms(tx, id, patch.rooms);
        if (refused) throw new Refused(refused);
      }
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof Refused) return err.failure;
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate" };
    throw err;
  }
}

/** Removes a facility and its rooms; bootcamps held there keep their schedule, without rooms. */
export async function deleteFacility(id: string): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const [deleted] = await db.delete(facilities).where(eq(facilities.id, id)).returning({ name: facilities.name });
  if (!deleted) return { ok: false, error: "not_found" };
  noteAudit({ target: id, targetLabel: deleted.name });
  return { ok: true };
}

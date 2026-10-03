/**
 * The bootcamps the Scheduler plans: listed, created, changed and removed.
 * At most one is active — a partial unique index holds that, and a write
 * that would break it is refused with the bootcamp already active.
 */

import "server-only";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  BOOTCAMP_LIMITS,
  BOOTCAMP_STATUSES,
  bootcamps,
  users,
  type BootcampStatus,
} from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import { isIsoDay } from "@/lib/evals/history-values";
import type { BootcampSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

export type BootcampRow = {
  id: string;
  startDate: string;
  btcDays: number;
  /** Null when it holds no intermediate class. */
  intDays: number | null;
  status: BootcampStatus;
  createdBy: string | null;
  createdAt: Date;
};

/** The active bootcamp, as the Current tab shows it. */
export type ActiveBootcamp = Pick<BootcampRow, "id" | "startDate" | "btcDays" | "intDays">;

const createdBy = sql<string | null>`coalesce(nullif(${users.name}, ''), ${users.email})`;

const SORT_COLUMNS = {
  startDate: bootcamps.startDate,
  status: bootcamps.status,
  createdBy: sql`lower(${createdBy})`,
} as const;

/** One page of bootcamps, latest first by default. The search matches the status or who created it. */
export async function listBootcamps(query: ListQuery<BootcampSort>): Promise<Page<BootcampRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: bootcamps.id,
      startDate: bootcamps.startDate,
      btcDays: bootcamps.btcDays,
      intDays: bootcamps.intDays,
      status: bootcamps.status,
      createdBy,
      createdAt: bootcamps.createdAt,
    })
    .from(bootcamps)
    .leftJoin(users, eq(users.id, bootcamps.createdBy))
    .where(searchAny(query.q, [bootcamps.status, users.name, users.email]))
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`${bootcamps.startDate} desc`, bootcamps.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

export async function activeBootcamp(): Promise<ActiveBootcamp | null> {
  const [row] = await db
    .select({
      id: bootcamps.id,
      startDate: bootcamps.startDate,
      btcDays: bootcamps.btcDays,
      intDays: bootcamps.intDays,
    })
    .from(bootcamps)
    .where(eq(bootcamps.status, "active"));
  return row ?? null;
}

const days = z.number().int().min(BOOTCAMP_LIMITS.minDays).max(BOOTCAMP_LIMITS.maxDays);

export const bootcampInputSchema = z.object({
  startDate: z.string().refine(isIsoDay, "not a YYYY-MM-DD day"),
  btcDays: days,
  /** Null for a bootcamp with no intermediate class. */
  intDays: days.nullable(),
  status: z.enum(BOOTCAMP_STATUSES),
});

/** An edit changes only the fields it names. */
export const bootcampPatchSchema = bootcampInputSchema.partial();

type BootcampInput = z.infer<typeof bootcampInputSchema>;
type BootcampPatch = z.infer<typeof bootcampPatchSchema>;

export type BootcampError = "not_found" | "active_exists";

export type BootcampFailure = {
  ok: false;
  error: BootcampError;
  /** For `active_exists`: the bootcamp that is active already. */
  active?: ActiveBootcamp;
};

const isUniqueViolation = (err: unknown): boolean => {
  const code = (e: unknown) => (e as { code?: unknown } | null)?.code;
  return code(err) === "23505" || code((err as { cause?: unknown } | null)?.cause) === "23505";
};

/** The refusal for making a second bootcamp active, naming the first. */
async function activeExists(): Promise<BootcampFailure> {
  return { ok: false, error: "active_exists", active: (await activeBootcamp()) ?? undefined };
}

export async function createBootcamp(
  actorId: string,
  input: BootcampInput,
): Promise<{ ok: true; id: string } | BootcampFailure> {
  if (input.status === "active" && (await activeBootcamp())) return activeExists();
  try {
    const [row] = await db
      .insert(bootcamps)
      .values({ ...input, createdBy: actorId })
      .returning({ id: bootcamps.id });
    noteAudit({ target: row!.id, targetLabel: `Bootcamp starting ${input.startDate}` });
    return { ok: true, id: row!.id };
  } catch (err) {
    // Another bootcamp made active in between.
    if (isUniqueViolation(err)) return activeExists();
    throw err;
  }
}

export async function updateBootcamp(id: string, patch: BootcampPatch): Promise<{ ok: true } | BootcampFailure> {
  const [before] = await db.select().from(bootcamps).where(eq(bootcamps.id, id));
  if (!before) return { ok: false, error: "not_found" };
  noteAudit({ target: id, targetLabel: `Bootcamp starting ${patch.startDate ?? before.startDate}` });
  if (patch.status === "active" && before.status !== "active") {
    const active = await activeBootcamp();
    if (active) return { ok: false, error: "active_exists", active };
  }
  try {
    const updated = await db
      .update(bootcamps)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(bootcamps.id, id))
      .returning({ id: bootcamps.id });
    return updated.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
  } catch (err) {
    if (isUniqueViolation(err)) return activeExists();
    throw err;
  }
}

export async function deleteBootcamp(id: string): Promise<boolean> {
  const deleted = await db
    .delete(bootcamps)
    .where(eq(bootcamps.id, id))
    .returning({ id: bootcamps.id, startDate: bootcamps.startDate });
  if (deleted[0]) noteAudit({ target: id, targetLabel: `Bootcamp starting ${deleted[0].startDate}` });
  return deleted.length > 0;
}

/**
 * The bootcamps the Scheduler plans: listed, created, changed and removed.
 * At most one is active — a partial unique index holds that, and a write
 * that would break it is refused with the bootcamp already active. Every
 * write retracks the org, since it can change which bootcamp is next and so
 * who is deferred from it.
 */

import "server-only";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  BOOTCAMP_LIMITS,
  BOOTCAMP_STATUSES,
  bootcampJudges,
  bootcamps,
  evalsSubmissions,
  users,
  type BootcampStatus,
} from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import { isIsoDay } from "@/lib/evals/history-values";
import { retrackOrg } from "@/lib/evals/tracks";
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
  /** How many guest judges it has. */
  judges: number;
};

/** The active bootcamp, as the Current tab shows it. */
export type ActiveBootcamp = Pick<BootcampRow, "id" | "startDate" | "btcDays" | "intDays">;

const createdBy = sql<string | null>`coalesce(nullif(${users.name}, ''), ${users.email})`;

// Spelled out, because Drizzle leaves the table off a column in a one-table
// query, and an unqualified `id` here would mean the judge's own.
const judges = sql<number>`(select count(*)::int from ${bootcampJudges} j where j.bootcamp_id = ${bootcamps}.id)`;

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
      judges,
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

/** One bootcamp, as its Scheduler page shows it, or null. */
export async function getBootcamp(id: string): Promise<BootcampRow | null> {
  const [row] = await db
    .select({
      id: bootcamps.id,
      startDate: bootcamps.startDate,
      btcDays: bootcamps.btcDays,
      intDays: bootcamps.intDays,
      status: bootcamps.status,
      createdBy,
      createdAt: bootcamps.createdAt,
      judges,
    })
    .from(bootcamps)
    .leftJoin(users, eq(users.id, bootcamps.createdBy))
    .where(eq(bootcamps.id, id));
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

const pgCode = (err: unknown): unknown => {
  const code = (e: unknown) => (e as { code?: unknown } | null)?.code;
  return code(err) ?? code((err as { cause?: unknown } | null)?.cause);
};

const isUniqueViolation = (err: unknown): boolean => pgCode(err) === "23505";

const isForeignKeyViolation = (err: unknown): boolean => pgCode(err) === "23503";

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
    await retrackOrg();
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
    if (updated.length === 0) return { ok: false, error: "not_found" };
    await retrackOrg();
    return { ok: true };
  } catch (err) {
    if (isUniqueViolation(err)) return activeExists();
    throw err;
  }
}

/**
 * Removes a bootcamp and its judges. One that attendees were scored at is
 * kept, with `has_scores`: removing it would take their assessments with it.
 */
export async function deleteBootcamp(id: string): Promise<{ ok: true } | { ok: false; error: "not_found" | "has_scores" }> {
  const [scored] = await db
    .select({ id: evalsSubmissions.id })
    .from(evalsSubmissions)
    .where(eq(evalsSubmissions.bootcampId, id))
    .limit(1);
  if (scored) return { ok: false, error: "has_scores" };
  let deleted: { id: string; startDate: string }[];
  try {
    deleted = await db
      .delete(bootcamps)
      .where(eq(bootcamps.id, id))
      .returning({ id: bootcamps.id, startDate: bootcamps.startDate });
  } catch (err) {
    // Scored in between: the foreign key refuses it.
    if (isForeignKeyViolation(err)) return { ok: false, error: "has_scores" };
    throw err;
  }
  if (!deleted[0]) return { ok: false, error: "not_found" };
  noteAudit({ target: id, targetLabel: `Bootcamp starting ${deleted[0].startDate}` });
  await retrackOrg();
  return { ok: true };
}

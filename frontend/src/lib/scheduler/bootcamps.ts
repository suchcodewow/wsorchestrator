/**
 * The bootcamps the Scheduler plans: listed, created, changed and removed.
 * At most one is active — a partial unique index holds that, and a write
 * that would break it is refused with the bootcamp already active, unless it
 * names that one in `completeActive`, which marks it complete first. Every
 * write retracks the org, since it can change which bootcamp is next and so
 * who is deferred from it.
 */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  BOOTCAMP_LIMITS,
  BOOTCAMP_STATUSES,
  EVALS_SLACK_CONTACT_LIMITS,
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
import { judgePicks, resolveJudges, setJudges, type JudgePick } from "@/lib/scheduler/judges";

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

/** One bootcamp with its guest judges, as its dialog edits it. */
export type BootcampDetail = BootcampRow & { judges: JudgePick[] };

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

/** One bootcamp and its judges, or null. */
export async function getBootcamp(id: string): Promise<BootcampDetail | null> {
  const [row] = await db
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
    .where(eq(bootcamps.id, id));
  return row ? { ...row, judges: await judgePicks(id) } : null;
}

/** Whether a bootcamp with this id exists. */
export async function bootcampExists(id: string): Promise<boolean> {
  const [row] = await db.select({ id: bootcamps.id }).from(bootcamps).where(eq(bootcamps.id, id));
  return Boolean(row);
}

const days = z.number().int().min(BOOTCAMP_LIMITS.minDays).max(BOOTCAMP_LIMITS.maxDays);

export const bootcampInputSchema = z.object({
  startDate: z.string().refine(isIsoDay, "not a YYYY-MM-DD day"),
  btcDays: days,
  /** Null for a bootcamp with no intermediate class. */
  intDays: days.nullable(),
  status: z.enum(BOOTCAMP_STATUSES),
  /** Every guest judge, by email; it replaces the set. Left out, the judges stay as they are. */
  judges: z.array(z.string().max(EVALS_SLACK_CONTACT_LIMITS.email)).max(BOOTCAMP_LIMITS.judges).optional(),
  /**
   * With status active, the id of the bootcamp active now: it is marked
   * complete in the same write. Naming any other is refused as active_exists.
   */
  completeActive: z.string().uuid().optional(),
});

/** An edit changes only the fields it names. */
export const bootcampPatchSchema = bootcampInputSchema.partial();

type BootcampInput = z.infer<typeof bootcampInputSchema>;
type BootcampPatch = z.infer<typeof bootcampPatchSchema>;

export type BootcampError = "invalid" | "not_employee" | "not_found" | "active_exists";

export const BOOTCAMP_STATUS_FOR: Record<BootcampError, number> = {
  invalid: 400,
  not_employee: 400,
  not_found: 404,
  active_exists: 409,
};

export type BootcampFailure = {
  ok: false;
  error: BootcampError;
  /** For `active_exists`: the bootcamp that is active already. */
  active?: ActiveBootcamp;
  /** For `not_employee`: the judge's email the employee list does not have. */
  email?: string;
};

/** The judges `emails` name, or the refusal; undefined leaves them alone. */
async function judgesFor(emails: string[] | undefined) {
  if (emails === undefined) return { ok: true as const, judges: undefined };
  return resolveJudges(emails);
}

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

/**
 * The refusal for making bootcamp `selfId` (null for a new one) active while
 * another is, unless `completeActive` names that other one.
 */
async function activeConflict(
  selfId: string | null,
  status: BootcampStatus | undefined,
  completeActive: string | undefined,
): Promise<BootcampFailure | null> {
  if (status !== "active") return null;
  const active = await activeBootcamp();
  if (!active || active.id === selfId || active.id === completeActive) return null;
  return { ok: false, error: "active_exists", active };
}

/** Marks the bootcamp `id` complete if it is still the active one. */
async function completeIfActive(tx: Pick<typeof db, "update">, id: string): Promise<void> {
  await tx
    .update(bootcamps)
    .set({ status: "complete", updatedAt: new Date() })
    .where(and(eq(bootcamps.id, id), eq(bootcamps.status, "active")));
}

export async function createBootcamp(
  actorId: string,
  input: BootcampInput,
): Promise<{ ok: true; id: string } | BootcampFailure> {
  const { judges: emails, completeActive, ...fields } = input;
  const judges = await judgesFor(emails);
  if (!judges.ok) return judges;
  const conflict = await activeConflict(null, input.status, completeActive);
  if (conflict) return conflict;
  try {
    const row = await db.transaction(async (tx) => {
      if (input.status === "active" && completeActive) await completeIfActive(tx, completeActive);
      const [made] = await tx
        .insert(bootcamps)
        .values({ ...fields, createdBy: actorId })
        .returning({ id: bootcamps.id });
      if (judges.judges) await setJudges(tx, actorId, made!.id, judges.judges);
      return made;
    });
    noteAudit({ target: row!.id, targetLabel: `Bootcamp starting ${input.startDate}` });
    await retrackOrg();
    return { ok: true, id: row!.id };
  } catch (err) {
    // Another bootcamp made active in between.
    if (isUniqueViolation(err)) return activeExists();
    throw err;
  }
}

export async function updateBootcamp(
  actorId: string,
  id: string,
  patch: BootcampPatch,
): Promise<{ ok: true } | BootcampFailure> {
  const [before] = await db.select().from(bootcamps).where(eq(bootcamps.id, id));
  if (!before) return { ok: false, error: "not_found" };
  noteAudit({ target: id, targetLabel: `Bootcamp starting ${patch.startDate ?? before.startDate}` });
  const { judges: emails, completeActive, ...fields } = patch;
  const conflict = await activeConflict(id, patch.status, completeActive);
  if (conflict) return conflict;
  const judges = await judgesFor(emails);
  if (!judges.ok) return judges;
  try {
    const updated = await db.transaction(async (tx) => {
      if (patch.status === "active" && completeActive && completeActive !== id) await completeIfActive(tx, completeActive);
      const rows = await tx
        .update(bootcamps)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(bootcamps.id, id))
        .returning({ id: bootcamps.id });
      if (rows.length > 0 && judges.judges) await setJudges(tx, actorId, id, judges.judges);
      return rows;
    });
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

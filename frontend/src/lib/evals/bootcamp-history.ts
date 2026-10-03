/**
 * Bootcamp history: who attended BTC and INT, and how they scored.
 *
 * This table is the record — it replaces the Bootcamp_History sheet, which
 * was imported once to start it. People are added and edited here; an upload
 * is still accepted, and writes only the columns its file has.
 */

import "server-only";

import { asc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { BOOTCAMP_HISTORY_LIMITS, BOOTCAMP_SCORE, bootcampHistory, type BootcampHistory } from "@/db/schema";
import { parseHistorySheet, type HistoryField, type HistoryProblem } from "@/lib/evals/bootcamp-history-file";
import { isIsoDay, normalEmail, roundScore } from "@/lib/evals/history-values";
import { retrackEmployees } from "@/lib/evals/tracks";
import { readSpreadsheet } from "@/lib/spreadsheet-file";

export async function listHistory(): Promise<BootcampHistory[]> {
  return db.select().from(bootcampHistory).orderBy(asc(bootcampHistory.email));
}

export type ImportError = "no_file" | "too_large" | "unreadable" | "empty" | "no_email_column" | "too_many_rows";

export type HistoryError = "invalid" | "duplicate" | "not_found";

export const STATUS_FOR: Record<ImportError | HistoryError, number> = {
  no_file: 400,
  too_large: 413,
  unreadable: 400,
  empty: 400,
  no_email_column: 400,
  too_many_rows: 413,
  invalid: 400,
  duplicate: 409,
  not_found: 404,
};

const email = z
  .string()
  .max(BOOTCAMP_HISTORY_LIMITS.email)
  .transform((v, ctx) => {
    const normal = normalEmail(v);
    if (normal) return normal;
    ctx.addIssue({ code: "custom", message: "not an email address" });
    return z.NEVER;
  });

const day = z.string().refine(isIsoDay).nullable();

const score = z.number().min(BOOTCAMP_SCORE.min).max(BOOTCAMP_SCORE.max).transform(roundScore).nullable();

/** One person's row as a form sets it. Individual scores come from grading, not the form. */
export const historyInputSchema = z.object({
  email,
  btcDate: day,
  intDate: day,
  btcScore: score,
  intScore: score,
});

/** An edit changes only the fields it names. */
export const historyPatchSchema = historyInputSchema.partial();

type HistoryInput = z.infer<typeof historyInputSchema>;
type HistoryPatch = z.infer<typeof historyPatchSchema>;

const isUniqueViolation = (err: unknown): boolean => {
  const code = (e: unknown) => (e as { code?: unknown } | null)?.code;
  return code(err) === "23505" || code((err as { cause?: unknown } | null)?.cause) === "23505";
};

export async function createHistory(
  actorId: string,
  input: HistoryInput,
): Promise<{ ok: true; id: string } | { ok: false; error: HistoryError }> {
  const [row] = await db
    .insert(bootcampHistory)
    .values({ ...input, updatedBy: actorId })
    .onConflictDoNothing()
    .returning({ id: bootcampHistory.id });
  if (!row) return { ok: false, error: "duplicate" };
  await retrackEmployees([input.email]);
  return { ok: true, id: row.id };
}

export async function updateHistory(
  actorId: string,
  id: string,
  patch: HistoryPatch,
): Promise<{ ok: true } | { ok: false; error: HistoryError }> {
  const [before] = await db
    .select({ email: bootcampHistory.email })
    .from(bootcampHistory)
    .where(eq(bootcampHistory.id, id));
  if (!before) return { ok: false, error: "not_found" };
  try {
    const updated = await db
      .update(bootcampHistory)
      .set({ ...patch, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(bootcampHistory.id, id))
      .returning({ email: bootcampHistory.email });
    if (updated.length === 0) return { ok: false, error: "not_found" };
    // A new email moves the track with it.
    await retrackEmployees([before.email, ...updated.map((u) => u.email)]);
    return { ok: true };
  } catch (err) {
    // A new email that someone else already has.
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate" };
    throw err;
  }
}

export async function deleteHistory(id: string): Promise<boolean> {
  const deleted = await db
    .delete(bootcampHistory)
    .where(eq(bootcampHistory.id, id))
    .returning({ email: bootcampHistory.email });
  await retrackEmployees(deleted.map((d) => d.email));
  return deleted.length > 0;
}

export type ImportSummary = {
  added: number;
  updated: number;
  problems: HistoryProblem[];
  ignoredColumns: string[];
};

const BATCH = 500;

const EXCLUDED: Record<HistoryField, SQL> = {
  btcDate: sql`excluded.btc_date`,
  intDate: sql`excluded.int_date`,
  btcScore: sql`excluded.btc_score`,
  intScore: sql`excluded.int_score`,
  btcIndividualScores: sql`excluded.btc_individual_scores`,
  intIndividualScores: sql`excluded.int_individual_scores`,
};

/**
 * Reads an uploaded sheet and stores its rows by email. Only the columns the
 * sheet has are written, so an INT-only sheet leaves BTC results alone; a
 * blank cell in one of them clears it. Emails not in the file are untouched.
 */
export async function importHistory(
  actorId: string,
  file: File | null,
): Promise<{ ok: true; summary: ImportSummary } | { ok: false; error: ImportError }> {
  if (!file || file.size === 0) return { ok: false, error: "no_file" };
  if (file.size > BOOTCAMP_HISTORY_LIMITS.bytes) return { ok: false, error: "too_large" };

  let parsed;
  try {
    parsed = parseHistorySheet(readSpreadsheet(Buffer.from(await file.arrayBuffer())));
  } catch {
    return { ok: false, error: "unreadable" };
  }
  if (!parsed.ok) return parsed;
  if (parsed.rows.length > BOOTCAMP_HISTORY_LIMITS.rows) return { ok: false, error: "too_many_rows" };

  const set = {
    ...Object.fromEntries(parsed.columns.map((c) => [c, EXCLUDED[c]])),
    updatedBy: sql`excluded.updated_by`,
    updatedAt: sql`excluded.updated_at`,
  };

  let added = 0;
  const now = new Date();
  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.rows.length; i += BATCH) {
      const batch = parsed.rows.slice(i, i + BATCH).map((r) => ({ ...r, updatedBy: actorId, updatedAt: now }));
      const written = await tx
        .insert(bootcampHistory)
        .values(batch)
        .onConflictDoUpdate({ target: bootcampHistory.email, set })
        // A row Postgres inserted, rather than updated, has no xmax yet.
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      added += written.filter((w) => w.inserted).length;
    }
  });
  await retrackEmployees(parsed.rows.map((r) => r.email));

  return {
    ok: true,
    summary: {
      added,
      updated: parsed.rows.length - added,
      problems: parsed.problems,
      ignoredColumns: parsed.ignoredColumns,
    },
  };
}

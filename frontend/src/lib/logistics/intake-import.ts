/**
 * Bringing a Google Form's responses into one intake form, for the cohorts
 * that answered there before /intake: a Training administrator uploads the
 * responses sheet, sees how it lines up, then imports it. Each row is stored
 * as that person's answers, dated by its Google timestamp, so an answer they
 * give in the app afterwards is newer and wins. The same file twice adds
 * nothing the second time.
 */

import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { intakeResponses, type IntakeFormId } from "@/db/schema";
import { currentCohortSubquery } from "@/lib/evals/current-cohort";
import { getIntakeForm } from "@/lib/logistics/intake";
import { planImport, type ImportColumn, type ImportProblem } from "@/lib/logistics/intake-import-plan";
import { readSpreadsheet } from "@/lib/spreadsheet-file";

export const INTAKE_IMPORT_LIMITS = { bytes: 2 * 1024 * 1024, rows: 2000 } as const;

export type IntakeImportError = "no_file" | "too_large" | "unreadable" | "empty" | "no_email_column" | "too_many_rows";

export type IntakeImportSummary = {
  /** Whether it was stored, or only looked at. */
  imported: boolean;
  columns: ImportColumn[];
  /** Rows that would be, or were, stored. */
  added: number;
  /** Rows already stored, from an earlier import of the same sheet. */
  alreadyThere: number;
  /** Of the people in the sheet, how many are in the current cohort, so show on Dietary needs. */
  inCohort: number;
  people: number;
  problems: ImportProblem[];
};

const BATCH = 500;

/**
 * Reads `file` and lines it up with form `form`; with `commit`, stores the
 * rows not already there. Without it nothing is written, so a person can
 * check the columns first.
 */
export async function importIntakeResponses(
  form: IntakeFormId,
  file: File | null,
  commit: boolean,
): Promise<{ ok: true; summary: IntakeImportSummary } | { ok: false; error: IntakeImportError }> {
  if (!file || file.size === 0) return { ok: false, error: "no_file" };
  if (file.size > INTAKE_IMPORT_LIMITS.bytes) return { ok: false, error: "too_large" };

  let rows;
  try {
    rows = readSpreadsheet(Buffer.from(await file.arrayBuffer())).rows;
  } catch {
    return { ok: false, error: "unreadable" };
  }
  if (rows.length - 1 > INTAKE_IMPORT_LIMITS.rows) return { ok: false, error: "too_many_rows" };

  const { questions } = await getIntakeForm(form);
  const plan = planImport(rows, questions);
  if ("error" in plan) return { ok: false, error: plan.error };

  // Imported before? The same person, form and Google timestamp is the same response.
  const now = new Date();
  const candidates = plan.entries.map((e) => ({ ...e, at: e.submittedAt ? new Date(e.submittedAt) : now }));
  const emails = [...new Set(candidates.map((e) => e.email))];
  const [existing, cohort] = await Promise.all([
    emails.length
      ? db
          .select({ email: intakeResponses.email, at: intakeResponses.submittedAt })
          .from(intakeResponses)
          .where(and(eq(intakeResponses.form, form), inArray(intakeResponses.email, emails)))
      : Promise.resolve([]),
    currentCohortSubquery(),
  ]);
  const seen = new Set(existing.map((r) => `${r.email} ${r.at.getTime()}`));
  const fresh = candidates.filter((e) => !seen.has(`${e.email} ${e.at.getTime()}`));

  const [{ inCohort } = { inCohort: 0 }] = emails.length
    ? await db
        .select({ inCohort: sql<number>`count(*)::int` })
        .from(cohort)
        .where(inArray(cohort.email, emails))
    : [];

  if (commit && fresh.length > 0) {
    await db.transaction(async (tx) => {
      for (let i = 0; i < fresh.length; i += BATCH) {
        await tx.insert(intakeResponses).values(
          fresh.slice(i, i + BATCH).map((e) => ({ form, email: e.email, answers: e.answers, submittedAt: e.at })),
        );
      }
    });
  }

  return {
    ok: true,
    summary: {
      imported: commit,
      columns: plan.columns,
      added: fresh.length,
      alreadyThere: candidates.length - fresh.length,
      inCohort,
      people: emails.length,
      problems: plan.problems,
    },
  };
}

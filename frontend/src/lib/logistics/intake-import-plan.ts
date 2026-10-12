/**
 * How a Google Form's responses sheet lines up with one of the intake forms:
 * which column holds the email, which the timestamp, which question each other
 * column answers, and the answers each row gives. Pure, so the unit suite
 * pins it; `intake-import.ts` reads the file and stores the result.
 *
 * Google writes a responses sheet with a "Timestamp" column, an "Email
 * Address" column when the form collects emails, then one column per question
 * headed by the question's title. A question that the form put its whole text
 * into the title, and the app splits into a description and a title, is still
 * found: a header that ends with a question's title is that question.
 */

import type { IntakeQuestion } from "@/db/schema";
import type { Cell } from "@/lib/spreadsheet-file";
import type { IntakeAnswers } from "@/lib/logistics/intake-values";

export type ImportColumn = { header: string; questionId: string | null };

export type ImportEntry = {
  /** The sheet's row number, counting the header as row 1, for a person to find it. */
  row: number;
  /** Lowercased. */
  email: string;
  /** From the Timestamp column; null where it has none that reads as a time. */
  submittedAt: string | null;
  answers: IntakeAnswers;
};

export type ImportProblem = { row: number; problem: "no_email" | "not_an_email" };

export type ImportPlan = {
  columns: ImportColumn[];
  entries: ImportEntry[];
  problems: ImportProblem[];
};

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** For matching a header to a title: case, runs of spaces and a trailing colon or question mark don't matter. */
export function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s:?]+$/, "");
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * A Timestamp cell as an ISO time: an Excel serial from an `.xlsx`, or the
 * `M/D/YYYY H:MM:SS` Google writes in a `.csv`. Read as UTC: the sheet does
 * not say its time zone, and this only orders an imported answer against one
 * given in the app, hours apart at the least.
 */
export function readTimestamp(cell: Cell): string | null {
  if (typeof cell === "number" && Number.isFinite(cell) && cell > 0) {
    return new Date(EXCEL_EPOCH + cell * DAY_MS).toISOString();
  }
  if (typeof cell !== "string") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(cell.trim());
  if (!m) return null;
  const [, month, day, year, hour = "0", minute = "0", second = "0"] = m;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Which question a header is: its title exactly, or a header that ends with it; the longest title wins. */
function questionFor(header: string, questions: IntakeQuestion[]): string | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  let best: { id: string; length: number } | null = null;
  for (const q of questions) {
    const t = normalizeHeader(q.title);
    if (!t) continue;
    if ((h === t || h.endsWith(t)) && (!best || t.length > best.length)) best = { id: q.id, length: t.length };
  }
  return best?.id ?? null;
}

/** A cell as an answer to `q`: checkboxes split on Google's ", ", everything else trimmed text. */
function answerFor(cell: Cell, q: IntakeQuestion): string | string[] | null {
  const text = cell === null ? "" : String(cell).trim();
  if (!text) return null;
  if (q.kind !== "checkboxes") return text;
  // An option with a comma in it would be split, so take every option first.
  const picked: string[] = [];
  let rest = text;
  for (const option of [...q.options].sort((a, b) => b.length - a.length)) {
    if (rest.includes(option)) {
      picked.push(option);
      rest = rest.replace(option, "");
    }
  }
  const others = rest
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...picked, ...others];
}

/** The sheet, its first row the headers, lined up with `questions`. */
export function planImport(rows: Cell[][], questions: IntakeQuestion[]): ImportPlan | { error: "no_email_column" | "empty" } {
  const [header, ...body] = rows;
  if (!header || body.length === 0) return { error: "empty" };
  const headers = header.map((c) => (c === null ? "" : String(c)));

  const emailAt = headers.findIndex((h) => /^email( address)?$/.test(normalizeHeader(h)));
  if (emailAt < 0) return { error: "no_email_column" };
  const timestampAt = headers.findIndex((h) => normalizeHeader(h) === "timestamp");
  const byId = new Map(questions.map((q) => [q.id, q]));

  const columns: ImportColumn[] = headers.map((h, i) => ({
    header: h,
    questionId: i === emailAt || i === timestampAt ? null : questionFor(h, questions),
  }));

  const entries: ImportEntry[] = [];
  const problems: ImportProblem[] = [];
  body.forEach((cells, i) => {
    const row = i + 2;
    if (cells.every((c) => c === null || String(c).trim() === "")) return;
    const email = String(cells[emailAt] ?? "").trim().toLowerCase();
    if (!email) return void problems.push({ row, problem: "no_email" });
    if (!LOOKS_LIKE_EMAIL.test(email)) return void problems.push({ row, problem: "not_an_email" });

    const answers: IntakeAnswers = {};
    columns.forEach(({ questionId }, c) => {
      const q = questionId ? byId.get(questionId) : undefined;
      if (!q) return;
      const a = answerFor(cells[c] ?? null, q);
      if (a !== null && (!Array.isArray(a) || a.length > 0)) answers[q.id] = a;
    });
    entries.push({ row, email, submittedAt: timestampAt >= 0 ? readTimestamp(cells[timestampAt] ?? null) : null, answers });
  });

  return { columns, entries, problems };
}


/**
 * The rows of a Bootcamp_History sheet, checked and ready to store.
 *
 * The sheet's columns are `email`, `BTCDate`, `INTDate`, `BTCScore`,
 * `INTScore`, `BTCIndividualScores` and `INTIndividualScores`, found by name
 * (in any case, and in any order) so a reordered export still reads. Only
 * `email` is required. Blank rows are skipped silently; a row with anything
 * unreadable is skipped and reported, so nothing is stored half-read.
 */

import { BOOTCAMP_SCORE } from "@/db/schema";
import { normalEmail, validIso } from "@/lib/evals/history-values";
import { excelSerialToIsoDate, type Cell, type Sheet } from "@/lib/spreadsheet-file";

export type HistoryInput = {
  email: string;
  btcDate: string | null;
  intDate: string | null;
  btcScore: number | null;
  intScore: number | null;
  btcIndividualScores: Record<string, number> | null;
  intIndividualScores: Record<string, number> | null;
};

export type HistoryProblem = { row: number; message: string };

export type HistoryField = Exclude<keyof HistoryInput, "email">;

export type ParsedHistory =
  | {
      ok: true;
      rows: HistoryInput[];
      /** The fields the sheet has a column for; only these are written. */
      columns: HistoryField[];
      problems: HistoryProblem[];
      ignoredColumns: string[];
    }
  | { ok: false; error: "no_email_column" | "empty" };

const COLUMNS = {
  email: "email",
  btcdate: "btcDate",
  intdate: "intDate",
  btcscore: "btcScore",
  intscore: "intScore",
  btcindividualscores: "btcIndividualScores",
  intindividualscores: "intIndividualScores",
} as const satisfies Record<string, keyof HistoryInput>;

type Field = (typeof COLUMNS)[keyof typeof COLUMNS];

const headerKey = (h: Cell) => String(h ?? "").toLowerCase().replace(/[\s_-]+/g, "");

const blank = (c: Cell) => c === null || (typeof c === "string" && c.trim() === "");

/**
 * A date cell: an Excel serial (a number, or a CSV's text of one),
 * `YYYY-MM-DD[…]`, or the sheet's US `M/D/YYYY[…]`.
 */
function readDate(cell: Cell, date1904: boolean): string | null | undefined {
  if (blank(cell)) return null;
  const s = String(cell).trim();
  if (typeof cell === "number" || /^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    return serial > 0 ? excelSerialToIsoDate(serial, date1904) : undefined;
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(s);
  if (m) return validIso(+m[1]!, +m[2]!, +m[3]!) ?? undefined;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\s)/.exec(s);
  if (m) return validIso(+m[3]!, +m[1]!, +m[2]!) ?? undefined;
  return undefined;
}

/** An overall score: a whole number from 1 (poor) to 4 (outstanding). */
function readScore(cell: Cell): number | null | undefined {
  if (blank(cell)) return null;
  const n = typeof cell === "number" ? cell : Number(cell!.trim());
  return Number.isInteger(n) && n >= BOOTCAMP_SCORE.min && n <= BOOTCAMP_SCORE.max ? n : undefined;
}

/** A JSON object of numbers, like `{"Score-Exams":4,"Score-Participation":3}`. */
function readScores(cell: Cell): Record<string, number> | null | undefined {
  if (blank(cell)) return null;
  try {
    const value: unknown = JSON.parse(String(cell));
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value);
    if (!entries.every(([, v]) => typeof v === "number" && Number.isFinite(v))) return undefined;
    return Object.fromEntries(entries) as Record<string, number>;
  } catch {
    return undefined;
  }
}

const LABELS: Record<Field, string> = {
  email: "email",
  btcDate: "BTCDate",
  intDate: "INTDate",
  btcScore: "BTCScore",
  intScore: "INTScore",
  btcIndividualScores: "BTCIndividualScores",
  intIndividualScores: "INTIndividualScores",
};

export function parseHistorySheet(sheet: Sheet): ParsedHistory {
  const headerIndex = sheet.rows.findIndex((r) => r.some((c) => !blank(c)));
  if (headerIndex < 0) return { ok: false, error: "empty" };
  const header = sheet.rows[headerIndex]!;

  const at = new Map<Field, number>();
  const ignoredColumns: string[] = [];
  header.forEach((h, i) => {
    if (blank(h)) return;
    const field = COLUMNS[headerKey(h) as keyof typeof COLUMNS];
    if (field && !at.has(field)) at.set(field, i);
    else ignoredColumns.push(String(h).trim());
  });
  if (!at.has("email")) return { ok: false, error: "no_email_column" };

  const cell = (row: Cell[], field: Field): Cell => {
    const i = at.get(field);
    return i === undefined ? null : (row[i] ?? null);
  };

  const byEmail = new Map<string, { input: HistoryInput; row: number }>();
  const problems: HistoryProblem[] = [];

  for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i]!;
    if (row.every(blank)) continue;
    const rowNumber = i + 1;

    const written = String(cell(row, "email") ?? "").trim().toLowerCase();
    const email = normalEmail(written);
    if (!email) {
      problems.push({
        row: rowNumber,
        message: written ? `“${written}” is not an email address` : "no email",
      });
      continue;
    }

    const bad: string[] = [];
    const check = <T>(field: Field, value: T | undefined): T | null => {
      if (value === undefined) bad.push(LABELS[field]);
      return value ?? null;
    };
    const input: HistoryInput = {
      email,
      btcDate: check("btcDate", readDate(cell(row, "btcDate"), sheet.date1904)),
      intDate: check("intDate", readDate(cell(row, "intDate"), sheet.date1904)),
      btcScore: check("btcScore", readScore(cell(row, "btcScore"))),
      intScore: check("intScore", readScore(cell(row, "intScore"))),
      btcIndividualScores: check("btcIndividualScores", readScores(cell(row, "btcIndividualScores"))),
      intIndividualScores: check("intIndividualScores", readScores(cell(row, "intIndividualScores"))),
    };
    if (bad.length > 0) {
      problems.push({ row: rowNumber, message: `${email}: unreadable ${bad.join(", ")}` });
      continue;
    }

    const earlier = byEmail.get(email);
    if (earlier) {
      problems.push({
        row: rowNumber,
        message: `${email} is also on row ${earlier.row}; this later row is the one kept`,
      });
    }
    byEmail.set(email, { input, row: rowNumber });
  }

  return {
    ok: true,
    rows: [...byEmail.values()].map((v) => v.input),
    columns: [...at.keys()].filter((f): f is HistoryField => f !== "email"),
    problems,
    ignoredColumns,
  };
}

/** Runs one read-only query for the database console. */

import { pool } from "@/db";

const STATEMENT_TIMEOUT_MS = 15_000;

export const MAX_ROWS = 1_000;

export const MAX_SQL_LENGTH = 20_000;

export type QueryResult = {
  ok: true;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  command: string;
};

export type QueryError = { ok: false; error: string };

function lastMeaningful(res: unknown): {
  fields?: { name: string }[];
  rows?: Record<string, unknown>[];
  rowCount?: number | null;
  command?: string;
} {
  const arr = Array.isArray(res) ? res : [res];
  for (let i = arr.length - 1; i >= 0; i--) {
    const r = arr[i] as { fields?: unknown[] };
    if (r && Array.isArray(r.fields) && r.fields.length > 0) {
      return r as never;
    }
  }
  return (arr[arr.length - 1] ?? {}) as never;
}

export async function runReadOnlyQuery(
  sqlText: string,
): Promise<QueryResult | QueryError> {
  const trimmed = sqlText.trim();
  if (trimmed.length === 0) return { ok: false, error: "Enter a query." };
  if (trimmed.length > MAX_SQL_LENGTH) {
    return { ok: false, error: `Query is too long (max ${MAX_SQL_LENGTH} chars).` };
  }

  const client = await pool.connect();
  const started = Date.now();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    const res = await client.query({ text: trimmed, rowMode: "array" });
    const meaningful = lastMeaningful(res) as {
      fields?: { name: string }[];
      rows?: unknown[][];
      rowCount?: number | null;
      command?: string;
    };

    const columns = (meaningful.fields ?? []).map((f) => f.name);
    const allRows = (meaningful.rows ?? []) as unknown[][];
    const truncated = allRows.length > MAX_ROWS;
    const rows = truncated ? allRows.slice(0, MAX_ROWS) : allRows;

    return {
      ok: true,
      columns,
      rows,
      rowCount: meaningful.rowCount ?? allRows.length,
      truncated,
      elapsedMs: Date.now() - started,
      command: meaningful.command ?? "",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

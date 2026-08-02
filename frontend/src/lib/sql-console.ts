import { pool } from "@/db";

/**
 * The admin SQL console. Runs one query against the database inside a
 * transaction that is fixed READ ONLY, so no statement — whatever its text —
 * can write, create, or drop anything. That structural guarantee is the whole
 * safety model here: we never try to parse or blocklist the SQL, we just make
 * writes impossible at the Postgres level and let it reject them.
 *
 * A per-statement timeout bounds runaway queries, and the result set is capped
 * before it is returned so a `select * from a-big-table` can't exhaust memory
 * or the response.
 */

/** Longest a single query may run before Postgres aborts it. */
const STATEMENT_TIMEOUT_MS = 15_000;

/** Most rows returned to the client; extras are dropped and flagged. */
export const MAX_ROWS = 1_000;

/** Longest query text accepted, so the textarea can't post something absurd. */
export const MAX_SQL_LENGTH = 20_000;

export type QueryResult = {
  ok: true;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  /** True when more than MAX_ROWS matched and the tail was dropped. */
  truncated: boolean;
  elapsedMs: number;
  /** e.g. "SELECT", "EXPLAIN" — the command the server reports running. */
  command: string;
};

export type QueryError = { ok: false; error: string };

/**
 * pg returns a single result for one statement and an array for several
 * (`a; b;`). We show the last one that produced a shape, which matches how a
 * psql user reads a multi-statement paste — the final result is the answer.
 */
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
    // READ ONLY before the first statement is what makes any write — DML, DDL,
    // or a volatile function that tries to write — fail with 25006 rather than
    // succeed. SET LOCAL scopes the timeout to this transaction only.
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
    // Postgres errors carry a human-readable message; surface it verbatim so
    // the console is usable for debugging the query itself.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    // Nothing to keep — a READ ONLY transaction has nothing to commit.
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

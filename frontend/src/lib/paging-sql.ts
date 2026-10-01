/** The Drizzle half of `paging.ts`: search conditions and sort orders for a page query. */

import "server-only";
import { SQL, asc, ilike, is, or, sql, type AnyColumn } from "drizzle-orm";
import type { SortDir } from "@/lib/paging";

/** `%text%` with the ILIKE wildcards in `text` escaped, so "100%" matches only itself. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * True when any of `columns` contains `q`, ignoring case; undefined (no
 * condition) when `q` is empty.
 */
export function searchAny(
  q: string,
  columns: (AnyColumn | SQL)[],
): SQL | undefined {
  if (!q) return undefined;
  const pattern = containsPattern(q);
  return or(...columns.map((c) => ilike(c as AnyColumn, pattern)));
}

/**
 * The ORDER BY for a sort: the chosen column in the chosen direction with
 * blanks last either way, then `tiebreak` — a column, ascending, or an
 * ordering already written — so that paging is stable.
 */
export function orderFor(
  column: AnyColumn | SQL,
  dir: SortDir,
  ...tiebreak: (AnyColumn | SQL)[]
): SQL[] {
  const primary =
    dir === "asc"
      ? sql`${column} asc nulls last`
      : sql`${column} desc nulls last`;
  return [
    primary,
    ...tiebreak.map((c) => (is(c, SQL) ? c : asc(c))),
  ];
}

/** A text column with '' read as null, so `orderFor` sinks blanks too. */
export function blankAsNull(column: AnyColumn): SQL {
  return sql`nullif(${column}, '')`;
}

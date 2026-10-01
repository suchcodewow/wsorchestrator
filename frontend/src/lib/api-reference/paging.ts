/**
 * The query fields every paged list takes, written once so each entry
 * describes them the same way. See `src/lib/paging.ts`.
 */

import { PAGE_SIZE } from "@/lib/paging";
import type { Field } from "./types";

/**
 * `q`, `sort`, `dir` and `page` for a list whose sorts are `sorts` and whose
 * default is the first, in `defaultDir`. `searches` says what `q` matches.
 */
export function listQuery(
  sorts: readonly string[],
  searches: string,
  defaultDir: "asc" | "desc" = "asc",
): Field[] {
  return [
    { name: "q", type: "string", note: `Matches any part of ${searches}, ignoring case.` },
    {
      name: "sort",
      type: sorts.map((s) => `"${s}"`).join(" | "),
      note: `Default ${sorts[0]}. Blanks sort last either way.`,
    },
    {
      name: "dir",
      type: '"asc" | "desc"',
      note: defaultDir === "desc" ? `Default desc for ${sorts[0]}, asc for any other sort.` : "Default asc.",
    },
    { name: "page", type: "integer", note: `From 1. Default 1. A page holds at most ${PAGE_SIZE}.` },
  ];
}

/** What a paged list adds to its body, after its rows. */
export const PAGE_FIELDS = "page: number, hasMore: boolean";

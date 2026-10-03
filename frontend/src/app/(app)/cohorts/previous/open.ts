/**
 * Which session days the Previous tab has open, carried in the URL as
 * `open=2026-09-14,2026-07-21` so that Back, and the back link on a person's
 * page, return to the list with the same days open.
 */

import { isIsoDay } from "@/lib/evals/history-values";
import { PREVIOUS_SESSION_LIST } from "@/lib/list-specs";
import { parseListQuery, withParams, writeListQuery } from "@/lib/paging";

export const OPEN_PARAM = "open";

/** More than anyone opens by hand; each one open is fetched again with the page. */
const MAX_OPEN = 10;

type Params = Record<string, string | string[] | undefined>;

/** The open days a URL names: real days only, each once, at most `MAX_OPEN`. */
export function parseOpen(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value[0] : value;
  return [...new Set((raw ?? "").split(",").filter(isIsoDay))].slice(0, MAX_OPEN);
}

/** The Previous tab as `params` left it: its sort, page and open days. */
export function previousHref(params: Params): string {
  const back = writeListQuery(parseListQuery(params, PREVIOUS_SESSION_LIST), PREVIOUS_SESSION_LIST);
  const open = parseOpen(params[OPEN_PARAM]);
  if (open.length) back.set(OPEN_PARAM, open.join(","));
  return withParams("/cohorts/previous", back);
}

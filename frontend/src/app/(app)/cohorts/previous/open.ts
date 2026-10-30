/**
 * Which session days the Previous tab has open, carried in the URL as
 * `open=2026-09-14,2026-07-21` so that Back returns to the list with the same
 * days open.
 */

import { isIsoDay } from "@/lib/evals/history-values";

export const OPEN_PARAM = "open";

/** More than anyone opens by hand; each one open is fetched again with the page. */
const MAX_OPEN = 10;

/** The open days a URL names: real days only, each once, at most `MAX_OPEN`. */
export function parseOpen(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value[0] : value;
  return [...new Set((raw ?? "").split(",").filter(isIsoDay))].slice(0, MAX_OPEN);
}

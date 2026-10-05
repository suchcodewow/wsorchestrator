/** How the tokens page words dates, counts and names. */

import type { TemplateSourceRow } from "@/lib/harness-templates";
import type { HarnessTokenSummary } from "@/lib/harness-tokens";

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

export const stamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** How far off `iso` is, as "in 3 hours" or "in 2 days". */
export function until(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "any moment now";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `in ${countOf(hours, "hour")}`;
  return `in ${countOf(Math.round(hours / 24), "day")}`;
}

export const plural = (n: number, many = "s", one = "") => (n === 1 ? one : many);

export const countOf = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export const tokenName = (t: HarnessTokenSummary) => t.accountName ?? t.accountId;

/** The place a template source reads from, as short as it can be said. */
export const sourceLabel = (s: TemplateSourceRow) =>
  s.projectIdentifier === null
    ? (s.orgName ?? s.orgIdentifier)
    : `${s.orgName ?? s.orgIdentifier} / ${s.projectName ?? s.projectIdentifier}`;

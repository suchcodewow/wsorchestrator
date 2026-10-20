"use client";

/**
 * Reporting → Bootcamp: an administrator's release buttons, the current
 * cohort, then everyone with a record, marked with the furthest class they
 * have been to. One search narrows both tables; a row opens that person.
 */

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronRight, UserCheck, UserX, type LucideIcon } from "lucide-react";
import {
  HEADER_ROW,
  LINK_ROW,
  Pager,
  PlainHeader,
  SortHeader,
  TableSearch,
  useRowLink,
} from "@/components/data-table";
import {
  BOOTCAMP_COHORT_PREFIX,
  type BootcampCohortSort,
  type BootcampRecordSort,
  type HistoryStatus,
} from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { BootcampRecordCounts, BootcampRecordRow, CohortRow } from "@/lib/reporting/bootcamp";
import { RELEASE_STAGES, STAGE_CODES, type ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { cn } from "@/lib/utils";
import { formatDate, formatScore } from "../../cohort-settings/format";
import { LevelChip } from "./class-card";
import { ReleaseButton } from "./release-button";

type Released = { at: string; byName: string | null } | null;

export type ViewBootcamp = {
  startDate: string;
  intermediate: boolean;
  released: Record<ReleaseStage, Released>;
};

const RECORD_COLUMNS: { column: BootcampRecordSort; label: string; className?: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "level", label: "Level", className: "whitespace-nowrap" },
  { column: "date", label: "Session Date", className: "whitespace-nowrap" },
];

const COHORT_COLUMNS: { column: BootcampCohortSort; label: string; className?: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "stage", label: "Class", className: "whitespace-nowrap" },
  { column: "averageScore", label: "Average", className: "whitespace-nowrap text-right" },
];

const STATUSES: { status: HistoryStatus; label: string; title: string; Icon: LucideIcon }[] = [
  { status: "active", label: "Active", title: "Still in the employee list from the last HiBob sync", Icon: UserCheck },
  { status: "inactive", label: "Inactive", title: "Not in the employee list from the last HiBob sync", Icon: UserX },
];

/** Shows only `status`, or everyone again when it is the one already shown; back to page 1 either way. */
function useStatusFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function toggle(status: HistoryStatus) {
    const next = new URLSearchParams(params.toString());
    if (next.get("status") === status) next.delete("status");
    else next.set("status", status);
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { toggle, pending };
}

export function BootcampView({
  everyone,
  canRelease,
  bootcamp,
  cohort,
  query,
  status,
  records,
  counts,
}: {
  /** An Assessments Viewer or above, who sees everyone rather than their org. */
  everyone: boolean;
  canRelease: boolean;
  /** The active bootcamp, or null with none. */
  bootcamp: ViewBootcamp | null;
  /** Its cohort, or null when there is none to show this reader. */
  cohort: { query: ListQuery<BootcampCohortSort>; page: Page<CohortRow> } | null;
  query: ListQuery<BootcampRecordSort>;
  status: HistoryStatus | null;
  records: Page<BootcampRecordRow>;
  counts: BootcampRecordCounts;
}) {
  const { toggle, pending } = useStatusFilter();
  // A person's page links back to the list as it is now: search, sorts, pages and status.
  const listParams = useSearchParams().toString();
  const hrefFor = (key: string) => `/reporting/bootcamp/${encodeURIComponent(key)}${listParams ? `?${listParams}` : ""}`;
  const rowLink = useRowLink();

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-4xl space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">Bootcamp</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              {counts.total.toLocaleString()} {counts.total === 1 ? "person" : "people"}
            </span>{" "}
            {everyone ? "with a BTC or INT record." : "in your org with a BTC or INT record."}
          </p>
        </div>
        {canRelease && (
          <div className="flex flex-wrap gap-2">
            {RELEASE_STAGES.map((stage) => (
              <ReleaseButton
                key={stage}
                stage={stage}
                startDate={bootcamp?.startDate ?? null}
                released={bootcamp?.released[stage] ?? null}
                unavailable={
                  !bootcamp
                    ? "No bootcamp is active"
                    : stage === "intermediate" && !bootcamp.intermediate
                      ? "The active bootcamp has no intermediate class"
                      : null
                }
              />
            ))}
          </div>
        )}
      </motion.div>

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <TableSearch
          value={query.q}
          placeholder="Search by name or email"
          label="Search bootcamp records"
          className="min-w-56 flex-1"
        />
        <div role="group" aria-label="Show" className="flex gap-2">
          {STATUSES.map(({ status: s, label, title, Icon }) => {
            const on = status === s;
            return (
              <button
                key={s}
                type="button"
                title={title}
                aria-pressed={on}
                disabled={pending}
                onClick={() => toggle(s)}
                className={cn(
                  "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait",
                  on
                    ? "border-brand-border bg-brand-subtle text-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <Icon className={cn("size-4", on && "text-brand")} />
                {label}
                <span className="font-medium tabular-nums text-foreground">{counts[s].toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      </motion.div>

      {bootcamp && cohort && (
        <motion.section variants={riseChild} className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-base font-medium tracking-tight">Current cohort</h3>
            <p className="text-sm text-muted-foreground">
              Starts {formatDate(bootcamp.startDate)}
              {(bootcamp.intermediate ? RELEASE_STAGES : (["bootcamp"] as const)).map((stage) => (
                <span key={stage}>
                  {" · "}
                  {STAGE_CODES[stage]}{" "}
                  {bootcamp.released[stage]
                    ? `released ${formatDate(bootcamp.released[stage].at.slice(0, 10))}`
                    : "not released to managers"}
                </span>
              ))}
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={HEADER_ROW}>
                    {COHORT_COLUMNS.map(({ column, label, className }) => (
                      <SortHeader
                        key={column}
                        column={column}
                        sort={cohort.query.sort}
                        dir={cohort.query.dir}
                        prefix={BOOTCAMP_COHORT_PREFIX}
                        className={className}
                      >
                        {label}
                      </SortHeader>
                    ))}
                    <PlainHeader className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {cohort.page.rows.map((m) => {
                    const href = hrefFor(m.key);
                    return (
                      <tr key={m.email} className={LINK_ROW} onClick={rowLink(href)}>
                        <td className="px-5 py-2.5 font-medium">
                          <Link href={href} className="outline-none group-hover:underline focus-visible:underline">
                            {m.fullName ?? <span className="font-normal text-muted-foreground">{m.email}</span>}
                          </Link>
                        </td>
                        <td className="px-5 py-2.5 text-muted-foreground">{m.email}</td>
                        <td className="px-5 py-2.5">
                          <LevelChip level={m.stage} />
                        </td>
                        <td
                          className="px-5 py-2.5 text-right whitespace-nowrap tabular-nums"
                          title={`${m.scored} ${m.scored === 1 ? "assessment" : "assessments"} scored`}
                        >
                          {formatScore(m.averageScore)}
                          <span className="ml-1.5 text-xs text-muted-foreground">({m.scored})</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </td>
                      </tr>
                    );
                  })}
                  {cohort.page.rows.length === 0 && (
                    <tr>
                      <td colSpan={COHORT_COLUMNS.length + 1} className="px-5 py-8 text-center text-muted-foreground">
                        {query.q
                          ? "No one in the cohort matches."
                          : cohort.page.page > 1
                            ? "No one on this page."
                            : everyone
                              ? "No one is in the cohort yet."
                              : "No one in your org is in this cohort."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t empty:hidden">
              <Pager page={cohort.page} noun="people" prefix={BOOTCAMP_COHORT_PREFIX} />
            </div>
          </div>
        </motion.section>
      )}

      <motion.section variants={riseChild} className="space-y-3">
        {bootcamp && cohort && <h3 className="text-base font-medium tracking-tight">Records</h3>}
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={HEADER_ROW}>
                  {RECORD_COLUMNS.map(({ column, label, className }) => (
                    <SortHeader key={column} column={column} sort={query.sort} dir={query.dir} className={className}>
                      {label}
                    </SortHeader>
                  ))}
                  <PlainHeader className="w-10" />
                </tr>
              </thead>
              <tbody>
                {records.rows.map((p) => {
                  const href = hrefFor(p.key);
                  return (
                    <tr key={p.email} className={LINK_ROW} onClick={rowLink(href)}>
                      <td className="px-5 py-2.5 font-medium">
                        <Link href={href} className="outline-none group-hover:underline focus-visible:underline">
                          {p.fullName ?? <span className="font-normal text-muted-foreground">—</span>}
                        </Link>
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground">{p.email}</td>
                      <td className="px-5 py-2.5">
                        <LevelChip level={p.level} />
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDate(p.date)}
                      </td>
                      <td className="px-3 py-2.5">
                        <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </td>
                    </tr>
                  );
                })}
                {records.rows.length === 0 && (
                  <tr>
                    <td colSpan={RECORD_COLUMNS.length + 1} className="px-5 py-8 text-center text-muted-foreground">
                      {query.q || status
                        ? "No one matches."
                        : records.page > 1
                          ? "No one on this page."
                          : everyone
                            ? "No bootcamp records yet."
                            : "No one in your org has a bootcamp record."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t empty:hidden">
            <Pager page={records} noun="people" />
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}

"use client";

/**
 * Reporting → Bootcamp: the current cohort, then everyone with a record,
 * marked with the furthest class they have been to. Both tables have the
 * same columns. One search narrows both;
 * the cohort can be narrowed to one class; a row opens that person.
 */

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronRight, Eye, UserCheck, UserX, type LucideIcon } from "lucide-react";
import {
  HEADER_ROW,
  LINK_ROW,
  Pager,
  PlainHeader,
  SortHeader,
  TableSearch,
  useRowLink,
} from "@/components/data-table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import {
  BOOTCAMP_COHORT_PREFIX,
  type BootcampCohortSort,
  type BootcampRecordSort,
  type HistoryStatus,
} from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { BootcampRecordCounts, BootcampRecordRow, CardViewer, CohortRow } from "@/lib/reporting/bootcamp";
import type { BootcampLevel, ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { cn } from "@/lib/utils";
import { formatDate, formatWholeScore, formatWhen } from "../../cohort-settings/format";
import { LevelChip } from "./class-card";

type Released = { at: string; byName: string | null } | null;

export type ViewBootcamp = {
  startDate: string;
  intermediate: boolean;
  released: Record<ReleaseStage, Released>;
};

type Column<S extends string> = { column: S; label: string; className?: string };

/** The same four columns in both tables, in the same order and widths, so the two line up. */
const RECORD_COLUMNS: Column<BootcampRecordSort>[] = [
  { column: "fullName", label: "Name" },
  { column: "level", label: "Class", className: "w-36 whitespace-nowrap" },
  { column: "averageScore", label: "Average score", className: "w-36 whitespace-nowrap text-right" },
  { column: "date", label: "Session Date", className: "w-40 whitespace-nowrap" },
];

const COHORT_COLUMNS: Column<BootcampCohortSort>[] = [
  { column: "fullName", label: "Name" },
  { column: "stage", label: "Class", className: "w-36 whitespace-nowrap" },
  { column: "averageScore", label: "Average score", className: "w-36 whitespace-nowrap text-right" },
  { column: "date", label: "Session Date", className: "w-40 whitespace-nowrap" },
];

/** A row of either table. */
type PersonRow = {
  key: string;
  email: string;
  fullName: string | null;
  level: BootcampLevel;
  averageScore: number | null;
  date: string;
  viewers: CardViewer[];
  viewerCount: number;
};

/** A quiet eye beside the name of someone whose card the reader has opened; hovered, it names everyone who opened it. */
function ViewedBy({ viewers, count }: { viewers: CardViewer[]; count: number }) {
  if (count === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`Viewed by ${count} ${count === 1 ? "person" : "people"}`}
          className="ml-2 inline-flex align-middle text-muted-foreground/60 outline-none transition-colors hover:text-muted-foreground focus-visible:text-foreground"
        >
          <Eye className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="space-y-1">
        <p className="font-medium">Viewed by</p>
        <ul className="space-y-0.5">
          {viewers.map((v) => (
            <li key={`${v.name}:${v.at}`} className="flex justify-between gap-4">
              <span>{v.name}</span>
              <span className="tabular-nums text-muted-foreground">{formatWhen(v.at)}</span>
            </li>
          ))}
        </ul>
        {count > viewers.length && <p className="text-muted-foreground">and {count - viewers.length} more</p>}
      </TooltipContent>
    </Tooltip>
  );
}

const STATUSES: { status: HistoryStatus; label: string; title: string; Icon: LucideIcon }[] = [
  { status: "active", label: "Active", title: "Still in the employee list from the last HiBob sync", Icon: UserCheck },
  { status: "inactive", label: "Inactive", title: "Not in the employee list from the last HiBob sync", Icon: UserX },
];

/**
 * Shows only `value` of the search parameter `name`, or everything again when
 * it is the one already shown; back to that table's page 1 either way.
 */
function useToggleFilter(name: string, pageParam: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function toggle(value: string) {
    const next = new URLSearchParams(params.toString());
    if (next.get(name) === value) next.delete(name);
    else next.set(name, value);
    next.delete(pageParam);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { toggle, pending };
}

/** A filter chip: pressed, it narrows its table; pressed again, it shows everything. */
function FilterChip({
  on,
  disabled,
  title,
  onClick,
  children,
}: {
  on: boolean;
  disabled: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait",
        on
          ? "border-brand-border bg-brand-subtle text-foreground"
          : "bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Either table: Name, Class, Average score and Session Date, a row opening the person. */
function PeopleTable<S extends string>({
  columns,
  query,
  prefix,
  rows,
  page,
  hrefFor,
  empty,
}: {
  columns: Column<S>[];
  query: ListQuery<S>;
  prefix?: string;
  rows: PersonRow[];
  page: Page<unknown>;
  hrefFor: (key: string) => string;
  empty: string;
}) {
  const rowLink = useRowLink();
  return (
    <TooltipProvider>
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 table-fixed text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {columns.map(({ column, label, className }) => (
                  <SortHeader
                    key={column}
                    column={column}
                    sort={query.sort}
                    dir={query.dir}
                    prefix={prefix}
                    className={className}
                  >
                    {label}
                  </SortHeader>
                ))}
                <PlainHeader className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const href = hrefFor(p.key);
                return (
                  <tr key={`${p.email}:${p.level}`} className={LINK_ROW} onClick={rowLink(href)}>
                    <td className="px-5 py-2.5 font-medium">
                      <Link href={href} className="outline-none group-hover:underline focus-visible:underline">
                        {p.fullName ?? <span className="font-normal text-muted-foreground">{p.email}</span>}
                      </Link>
                      <ViewedBy viewers={p.viewers} count={p.viewerCount} />
                    </td>
                    <td className="px-5 py-2.5">
                      <LevelChip level={p.level} />
                    </td>
                    <td className="px-5 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatWholeScore(p.averageScore)}
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
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="px-5 py-8 text-center text-muted-foreground">
                    {empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="people" prefix={prefix} />
        </div>
      </div>
    </TooltipProvider>
  );
}

export function BootcampView({
  everyone,
  bootcamp,
  cohort,
  query,
  status,
  records,
  counts,
}: {
  /** An Assessments Viewer or above, who sees everyone rather than their org. */
  everyone: boolean;
  /** The active bootcamp, or null with none. */
  bootcamp: ViewBootcamp | null;
  /** Its cohort, or null when there is none to show this reader: the classes they may see, the one shown, and how many are in each. */
  cohort: {
    query: ListQuery<BootcampCohortSort>;
    page: Page<CohortRow>;
    stages: ReleaseStage[];
    stage: ReleaseStage | null;
    counts: Record<ReleaseStage, number>;
  } | null;
  query: ListQuery<BootcampRecordSort>;
  status: HistoryStatus | null;
  records: Page<BootcampRecordRow>;
  counts: BootcampRecordCounts;
}) {
  const { toggle, pending } = useToggleFilter("status", "page");
  const stageFilter = useToggleFilter(`${BOOTCAMP_COHORT_PREFIX}.stage`, `${BOOTCAMP_COHORT_PREFIX}.page`);
  // A person's page links back to the list as it is now: search, sorts, pages and filters.
  const listParams = useSearchParams().toString();
  const hrefFor = (key: string) => `/reporting/bootcamp/${encodeURIComponent(key)}${listParams ? `?${listParams}` : ""}`;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-4xl space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">Live Sessions</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              {counts.total.toLocaleString()} {counts.total === 1 ? "person" : "people"}
            </span>{" "}
            {everyone ? "with a Bootcamp or Intermediate record." : "in your org with a Bootcamp or Intermediate record."}
          </p>
        </div>
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
              <FilterChip key={s} on={on} disabled={pending} title={title} onClick={() => toggle(s)}>
                <Icon className={cn("size-4", on && "text-brand")} />
                {label}
                <span className="font-medium tabular-nums text-foreground">{counts[s].toLocaleString()}</span>
              </FilterChip>
            );
          })}
        </div>
      </motion.div>

      {bootcamp && cohort && (
        <motion.section variants={riseChild} className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h3 className="text-base font-medium tracking-tight">Current cohort</h3>
            {cohort.stages.length > 1 && (
              <div role="group" aria-label="Show class" className="flex gap-2">
                {cohort.stages.map((st) => (
                  <FilterChip
                    key={st}
                    on={cohort.stage === st}
                    disabled={stageFilter.pending}
                    onClick={() => stageFilter.toggle(st)}
                  >
                    {STAGE_LABELS[st]}
                    <span className="font-medium tabular-nums text-foreground">
                      {cohort.counts[st].toLocaleString()}
                    </span>
                  </FilterChip>
                ))}
              </div>
            )}
          </div>
          <PeopleTable
            columns={COHORT_COLUMNS}
            query={cohort.query}
            prefix={BOOTCAMP_COHORT_PREFIX}
            rows={cohort.page.rows.map((m) => ({ ...m, level: m.stage }))}
            page={cohort.page}
            hrefFor={hrefFor}
            empty={
              query.q || cohort.stage
                ? "No one in the cohort matches."
                : cohort.page.page > 1
                  ? "No one on this page."
                  : everyone
                    ? "No one is in the cohort yet."
                    : "No one in your org is in this cohort."
            }
          />
        </motion.section>
      )}

      <motion.section variants={riseChild} className="space-y-3">
        {bootcamp && cohort && <h3 className="text-base font-medium tracking-tight">History</h3>}
        <PeopleTable
          columns={RECORD_COLUMNS}
          query={query}
          rows={records.rows}
          page={records}
          hrefFor={hrefFor}
          empty={
            query.q || status
              ? "No one matches."
              : records.page > 1
                ? "No one on this page."
                : everyone
                  ? "No bootcamp records yet."
                  : "No one in your org has a bootcamp record."
          }
        />
      </motion.section>
    </motion.div>
  );
}

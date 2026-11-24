"use client";

/**
 * Reporting → Live Sessions: one table of everyone with a record, marked with
 * the furthest class they have been to, whether they graduated from the
 * latest released bootcamp, and for an Assessments Viewer the class still
 * being judged they are in. It opens on those graduates; a viewer can switch
 * to that class, which shows its members with their score there. One search,
 * the filters and a row opening that person.
 */

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronRight, Eye, GraduationCap, Presentation, UserCheck, UserX, type LucideIcon } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { BootcampRecordSort, HistoryStatus, TrackFilter } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { BootcampRecordCounts, BootcampRecordRow, CardViewer, LiveSessionsFilters } from "@/lib/reporting/bootcamp";
import { cohortMonth, type ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { cn } from "@/lib/utils";
import { formatDate, formatWholeScore, formatWhen } from "../../cohort-settings/format";
import { LevelChip } from "./class-card";

type Released = { at: string; byName: string | null } | null;

/** A bootcamp and whether each class's scores are out, as Reporting Settings → Feedback shows it. */
export type ViewBootcamp = {
  startDate: string;
  intermediate: boolean;
  released: Record<ReleaseStage, Released>;
};

/** The latest released bootcamp, whose graduates the table opens on. */
export type ViewGraduates = { startDate: string; stages: ReleaseStage[] };

/** The class still being judged, for an Assessments Viewer: its classes and how many are in each. */
export type ViewClass = { startDate: string; stages: ReleaseStage[]; counts: Record<ReleaseStage, number> };

type Column = { column: BootcampRecordSort; label: string; className?: string };

const COLUMNS: Column[] = [
  { column: "fullName", label: "Name" },
  { column: "level", label: "Most Recent Class", className: "w-44 whitespace-nowrap" },
  { column: "bootcampScore", label: "BTC Score", className: "w-32 whitespace-nowrap" },
  { column: "intermediateScore", label: "INT Score", className: "w-32 whitespace-nowrap" },
  { column: "date", label: "Session Date", className: "w-40 whitespace-nowrap" },
];

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

const TRACKS: { track: TrackFilter; label: string }[] = [
  { track: "sales", label: "Sales" },
  { track: "engineer", label: "Engineer" },
];

/** A box round chips of which at most one is pressed; each box narrows on its own. */
function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5 rounded-full border p-1">
      {children}
    </div>
  );
}

/** Replaces the page's search parameters with `changes`, a null deleting one, back to page 1. */
function useSetParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) next.delete(name);
      else next.set(name, value);
    }
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { set, pending };
}

/** A filter chip: pressed, it narrows the table; pressed again, it shows everything. */
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

const Count = ({ n }: { n: number }) => <span className="font-medium tabular-nums text-foreground">{n.toLocaleString()}</span>;

/** A whole-number score, orange at 1 or 2 and green at 4; empty before the class is attended or scored. */
function ScoreCell({ score }: { score: number | null }) {
  if (score === null) return null;
  const whole = Number(formatWholeScore(score));
  return (
    <span
      className={cn(
        whole <= 2 && "font-medium text-orange-600 dark:text-orange-400",
        whole === 4 && "font-medium text-green-600 dark:text-green-400",
      )}
    >
      {formatWholeScore(score)}
    </span>
  );
}

export function BootcampView({
  everyone,
  graduates,
  inClass,
  query,
  filters,
  records,
  counts,
}: {
  /** An Assessments Viewer or above, who sees everyone rather than their org. */
  everyone: boolean;
  /** The latest released bootcamp, or null before any is. */
  graduates: ViewGraduates | null;
  /** The class still being judged, for an Assessments Viewer while there is one; null otherwise. */
  inClass: ViewClass | null;
  query: ListQuery<BootcampRecordSort>;
  filters: LiveSessionsFilters;
  records: Page<BootcampRecordRow>;
  counts: BootcampRecordCounts;
}) {
  const { set, pending } = useSetParams();
  const rowLink = useRowLink();
  // A person's page links back to the list as it is now: search, sorts, pages and filters.
  const listParams = useSearchParams().toString();
  const hrefFor = (key: string) => {
    const params = new URLSearchParams(listParams);
    params.set("from", "history");
    return `/reporting/bootcamp/${encodeURIComponent(key)}?${params}`;
  };

  const { show } = filters;
  // Pressing the one shown shows everyone; the graduates are where the page opens, so leaving them is said outright.
  const toggleShow = (value: "graduates" | "class") => set({ show: show === value ? "all" : value, stage: null, status: null });
  const toggle = (name: "stage" | "status" | "track", value: string) => set({ [name]: filters[name] === value ? null : value });

  const stageChips =
    show === "graduates" && graduates && graduates.stages.length > 1
      ? graduates.stages.map((st) => ({ stage: st, count: counts.graduates[st] }))
      : show === "class" && inClass && inClass.stages.length > 1
        ? inClass.stages.map((st) => ({ stage: st, count: inClass.counts[st] }))
        : [];
  const graduateTotal = counts.graduates.bootcamp + counts.graduates.intermediate;
  const classTotal = inClass ? inClass.stages.reduce((n, st) => n + inClass.counts[st], 0) : 0;
  const narrowed = Boolean(query.q || filters.status || filters.track || filters.stage);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-5xl space-y-6">
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
        <TableSearch value={query.q} placeholder="Search by name or email" label="Search bootcamp records" className="min-w-56 flex-1" />
      </motion.div>

      <motion.section variants={riseChild} className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {(graduates || inClass) && (
            <ChipGroup label="Show">
              {graduates && (
                <FilterChip on={show === "graduates"} disabled={pending} onClick={() => toggleShow("graduates")}>
                  <GraduationCap className={cn("size-4", show === "graduates" && "text-brand")} />
                  {cohortMonth(graduates.startDate)} Graduates
                  <Count n={graduateTotal} />
                </FilterChip>
              )}
              {inClass && (
                <FilterChip on={show === "class"} disabled={pending} onClick={() => toggleShow("class")}>
                  <Presentation className={cn("size-4", show === "class" && "text-brand")} />
                  {cohortMonth(inClass.startDate)} Class
                  <Count n={classTotal} />
                </FilterChip>
              )}
            </ChipGroup>
          )}
          {stageChips.length > 0 && (
            <ChipGroup label="Show class">
              {stageChips.map(({ stage, count }) => (
                <FilterChip key={stage} on={filters.stage === stage} disabled={pending} onClick={() => toggle("stage", stage)}>
                  {STAGE_LABELS[stage]}
                  <Count n={count} />
                </FilterChip>
              ))}
            </ChipGroup>
          )}
          {/* Its counts are of everyone, so it sits with everyone. */}
          {show === "all" && (
            <ChipGroup label="Show status">
              {STATUSES.map(({ status: s, label, title, Icon }) => {
                const on = filters.status === s;
                return (
                  <FilterChip key={s} on={on} disabled={pending} title={title} onClick={() => toggle("status", s)}>
                    <Icon className={cn("size-4", on && "text-brand")} />
                    {label}
                    <Count n={counts[s]} />
                  </FilterChip>
                );
              })}
            </ChipGroup>
          )}
          <ChipGroup label="Show track">
            {TRACKS.map(({ track: t, label }) => (
              <FilterChip key={t} on={filters.track === t} disabled={pending} onClick={() => toggle("track", t)}>
                {label}
                <Count n={counts[t]} />
              </FilterChip>
            ))}
          </ChipGroup>
        </div>

        <TooltipProvider>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-200 table-fixed text-sm">
                <thead>
                  <tr className={HEADER_ROW}>
                    {COLUMNS.map(({ column, label, className }) => (
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
                        <td className="px-5 py-2.5 whitespace-nowrap tabular-nums">
                          <ScoreCell score={p.bootcampScore} />
                        </td>
                        <td className="px-5 py-2.5 whitespace-nowrap tabular-nums">
                          <ScoreCell score={p.intermediateScore} />
                        </td>
                        <td className="px-5 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">{formatDate(p.date)}</td>
                        <td className="px-3 py-2.5">
                          <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </td>
                      </tr>
                    );
                  })}
                  {records.rows.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNS.length + 1} className="px-5 py-8 text-center text-muted-foreground">
                        {narrowed
                          ? "No one matches."
                          : records.page > 1
                            ? "No one on this page."
                            : show === "class"
                              ? "No one is in the class yet."
                              : show === "graduates"
                                ? everyone
                                  ? "No one graduated from it."
                                  : "No one in your org graduated from it."
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
        </TooltipProvider>
      </motion.section>
    </motion.div>
  );
}

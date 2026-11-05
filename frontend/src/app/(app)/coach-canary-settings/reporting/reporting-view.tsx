"use client";

/**
 * Everyone's progress through Coach Canary, a row each: concept videos watched
 * to the end, concepts mastered in chat, and the three hands-on experiences.
 * The Developer experience shows when it was first finished; the Enterprise
 * Security Team its best total and how many runs; the slide review how many
 * slides are done and the sum of their best scores. A row opens to each
 * slide's attempts and best score.
 */

import { Fragment, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import type { ExperienceReportSort } from "@/lib/list-specs";
import type { ExperienceReportRow } from "@/lib/mimir/experience-progress";
import { MAX_SCORE as SECURITY_MAX } from "@/lib/mimir/security-game/scenario";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";

export type SlideBrief = { id: string; subtitle: string; flaws: number };

/** The day alone: the column is about whether it was finished, and the time would only crowd it. */
const DAY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const COLUMNS: { column: ExperienceReportSort; label: string; className?: string }[] = [
  { column: "user", label: "Person" },
  { column: "videos", label: "Videos completed", className: "text-right" },
  { column: "mastered", label: "Topics mastered", className: "text-right" },
  { column: "developer", label: "Developer" },
  { column: "security", label: "Security Team" },
  { column: "slides", label: "Slide review" },
];

export function ReportingView({
  query,
  page,
  slides,
}: {
  query: ListQuery<ExperienceReportSort>;
  page: Page<ExperienceReportRow>;
  /** The slide review's slides, in order, to lay each person's slides out against. */
  slides: SlideBrief[];
}) {
  const rowLink = useRowLink();
  const [open, setOpen] = useState<string | null>(null);
  const sortProps = { sort: query.sort, dir: query.dir };
  const slidesMax = slides.reduce((sum, s) => sum + s.flaws, 0);

  return (
    <motion.div variants={staggerParent(0.04)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild}>
        <h2 className="text-xl font-medium tracking-tight">Reporting</h2>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search people" label="Search people" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map(({ column, label, className }) => (
                  <SortHeader key={column} column={column} {...sortProps} className={className}>
                    {label}
                  </SortHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "Nothing matches that search." : "No one has an account yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((r) => {
                const expanded = open === r.userId;
                const toggle = () => setOpen(expanded ? null : r.userId);
                return (
                  <Fragment key={r.userId}>
                    <tr className={LINK_ROW} onClick={rowLink(toggle)}>
                      <td className="max-w-xs px-5 py-3">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={toggle}
                          className="inline-flex max-w-full cursor-pointer items-center gap-2 text-left font-medium group-hover:underline"
                        >
                          <ChevronRight className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-90")} />
                          <span className="truncate">{r.name || r.email || "Unknown"}</span>
                        </button>
                        {r.name && r.email && <span className="block truncate pl-6 text-xs text-muted-foreground">{r.email}</span>}
                      </td>
                      <Count n={r.videos} />
                      <Count n={r.mastered} />
                      <td className="px-5 py-3">
                        {r.developerCompletedAt ? (
                          <span className="whitespace-nowrap" title={new Date(r.developerCompletedAt).toLocaleString()}>
                            <Done /> {DAY.format(new Date(r.developerCompletedAt))}
                          </span>
                        ) : (
                          <None />
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {r.securityAttempts ? (
                          <Scored best={r.securityBest} max={SECURITY_MAX} attempts={r.securityAttempts} />
                        ) : (
                          <None />
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {r.slidesDone ? (
                          <span className="tabular-nums">
                            {r.slidesDone} of {slides.length} slides
                            <span className="text-muted-foreground">
                              {" "}
                              · best {r.slidesBest ?? 0} / {slidesMax}
                            </span>
                          </span>
                        ) : (
                          <None />
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b bg-muted/20 last:border-b-0">
                        <td colSpan={COLUMNS.length} className="px-5 py-3">
                          <SlideBreakdown row={r} slides={slides} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager page={page} noun="people" />
      </motion.div>
    </motion.div>
  );
}

/** Each slide of the slide review, finished or not, with its best score and attempts. */
function SlideBreakdown({ row, slides }: { row: ExperienceReportRow; slides: SlideBrief[] }) {
  const bySlide = new Map(row.slides.map((s) => [s.slide, s]));
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">Slide review, slide by slide</p>
      <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-5">
        {slides.map((s, i) => {
          const done = bySlide.get(s.id);
          return (
            <li key={s.id} className="flex items-baseline gap-2 text-xs" title={s.subtitle}>
              <span className="w-14 shrink-0 font-medium">Slide {i + 1}</span>
              {done ? <Scored best={done.bestScore} max={s.flaws} attempts={done.attempts} /> : <None />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Scored({ best, max, attempts }: { best: number | null; max: number; attempts: number }) {
  return (
    <span className="tabular-nums">
      <span className={cn("font-medium", (best ?? 0) < 0 && "text-destructive")}>{best ?? "—"}</span>
      <span className="text-muted-foreground">
        {" "}
        / {max} · {attempts} {attempts === 1 ? "attempt" : "attempts"}
      </span>
    </span>
  );
}

function Count({ n }: { n: number }) {
  return <td className={cn("px-5 py-3 text-right tabular-nums", n === 0 && "text-muted-foreground")}>{n}</td>;
}

function Done() {
  return <span className="font-medium text-emerald-600 dark:text-emerald-400">Completed</span>;
}

function None() {
  return <span className="text-muted-foreground">—</span>;
}

"use client";

/**
 * Every daily survey with at least one response, as a card: the bootcamp's
 * month, the group it went to, the day, and the day's average overall
 * rating. A card opens the survey's responses. Above them, while nothing is
 * searched, a card for each Bootcamp's superlatives anyone has voted on.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { Pager, TableSearch, useListParams } from "@/components/data-table";
import { cn } from "@/lib/utils";
import type { SurveyResultSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { SUPERLATIVES_TITLE } from "@/lib/surveys/superlative-values";
import type { SuperlativeResultCard } from "@/lib/surveys/superlatives";
import type { SurveyResultCard } from "@/lib/surveys/surveys";
import { formatAverage, surveyGroupLabel, surveyMonth } from "@/lib/surveys/survey-values";

/** A small ring filled to `percent`. */
function CompletionRing({ percent }: { percent: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className="size-6 -rotate-90" role="img" aria-label={`${Math.round(percent)}% answered`}>
      <circle cx="12" cy="12" r={r} fill="none" strokeWidth="3" className="stroke-muted" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(Math.max(percent, 0), 100) / 100)}
        className="stroke-brand"
      />
    </svg>
  );
}

const CARD =
  "group flex h-full flex-col gap-4 rounded-2xl border bg-card px-5 py-4 shadow-sm transition-colors hover:border-brand-border hover:bg-muted/30 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

export function SurveyResultsView({
  query,
  today,
  page,
  superlatives,
}: {
  query: ListQuery<SurveyResultSort>;
  today: boolean;
  page: Page<SurveyResultCard>;
  superlatives: SuperlativeResultCard[];
}) {
  const { set } = useListParams();
  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.h1 variants={riseChild} className="text-3xl font-medium tracking-tight">
        Survey Results
      </motion.h1>

      {!query.q && superlatives.length > 0 && (
        <motion.section variants={riseChild} className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Superlatives</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {superlatives.map((r) => (
              <li key={r.id}>
                <Link href={`/survey-results/superlatives/${r.id}`} className={CARD}>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">{surveyMonth(r.startDate)}</p>
                    <p className="flex items-center gap-1.5 font-medium group-hover:underline">
                      <Trophy className="size-4 text-brand" />
                      {SUPERLATIVES_TITLE}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {r.superlatives} {r.superlatives === 1 ? "superlative" : "superlatives"}
                    </p>
                  </div>
                  <p className="mt-auto text-right text-xs text-muted-foreground tabular-nums">
                    {r.responses} of {r.assigned} voted
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </motion.section>
      )}

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-4">
        <TableSearch value={query.q} placeholder="Search by month or group" label="Search survey results" className="max-w-md" />
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <button
            type="button"
            role="switch"
            aria-checked={today}
            onClick={() => set({ today: today ? null : "1" })}
            className={cn(
              "relative h-5 w-9 rounded-full border transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              today ? "border-brand bg-brand" : "bg-muted",
            )}
          >
            <span
              className={cn("absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all", today ? "left-[1.1rem]" : "left-0.5")}
            />
          </button>
          Today only
        </label>
      </motion.div>

      {page.rows.length === 0 ? (
        <motion.p variants={riseChild} className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
          {query.q ? "No surveys match that search." : "No one has answered a survey yet."}
        </motion.p>
      ) : (
        <motion.ul variants={staggerParent(0.03)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {page.rows.map((r) => (
            <motion.li key={r.id} variants={riseChild}>
              <Link href={`/survey-results/${r.id}`} className={CARD}>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">{surveyMonth(r.startDate)}</p>
                  <p className="font-medium group-hover:underline">{surveyGroupLabel(r.stage, r.audience)}</p>
                  <p className="text-sm text-muted-foreground">Day {r.day}</p>
                </div>
                <div className="mt-auto flex items-end justify-between gap-3">
                  <div>
                    <p className="text-3xl font-medium tabular-nums">{formatAverage(r.average)}</p>
                    <p className="text-xs text-muted-foreground">Day overall, out of 5</p>
                  </div>
                  <div title={`${r.responses} of ${r.assigned} answered`}>
                    <CompletionRing percent={r.assigned ? (r.responses / r.assigned) * 100 : 0} />
                  </div>
                </div>
              </Link>
            </motion.li>
          ))}
        </motion.ul>
      )}

      <Pager page={page} noun="surveys" />
    </motion.div>
  );
}

"use client";

/**
 * Every daily survey with at least one response, as a card: the bootcamp's
 * month, the group it went to, the day, and the day's average overall
 * rating. A card opens the survey's responses.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import { Pager, TableSearch } from "@/components/data-table";
import type { SurveyResultSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { SurveyResultCard } from "@/lib/surveys/surveys";
import { formatAverage, surveyDate, surveyGroupLabel, surveyMonth } from "@/lib/surveys/survey-values";

export function SurveyResultsView({ query, page }: { query: ListQuery<SurveyResultSort>; page: Page<SurveyResultCard> }) {
  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.h1 variants={riseChild} className="text-3xl font-medium tracking-tight">
        Survey Results
      </motion.h1>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by month or group" label="Search survey results" className="max-w-md" />
      </motion.div>

      {page.rows.length === 0 ? (
        <motion.p variants={riseChild} className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
          {query.q ? "No surveys match that search." : "No one has answered a survey yet."}
        </motion.p>
      ) : (
        <motion.ul variants={staggerParent(0.03)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {page.rows.map((r) => (
            <motion.li key={r.id} variants={riseChild}>
              <Link
                href={`/survey-results/${r.id}`}
                className="group flex h-full flex-col gap-4 rounded-2xl border bg-card px-5 py-4 shadow-sm transition-colors hover:border-brand-border hover:bg-muted/30 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">{surveyMonth(r.startDate)}</p>
                  <p className="font-medium group-hover:underline">{surveyGroupLabel(r.stage, r.audience)}</p>
                  <p className="text-sm text-muted-foreground">
                    Day {r.day} · {surveyDate(r.date)}
                  </p>
                </div>
                <div className="mt-auto flex items-end justify-between gap-3">
                  <div>
                    <p className="text-3xl font-medium tabular-nums">{formatAverage(r.average)}</p>
                    <p className="text-xs text-muted-foreground">Day overall, out of 5</p>
                  </div>
                  <p className="text-right text-xs text-muted-foreground tabular-nums">
                    {r.responses} of {r.assigned} answered
                  </p>
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

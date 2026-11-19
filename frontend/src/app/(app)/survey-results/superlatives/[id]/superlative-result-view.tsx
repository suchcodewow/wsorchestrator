"use client";

/**
 * One Bootcamp's superlatives results: each superlative with whoever leads
 * it, every one of them on a tie, then everyone else voted for, the most
 * votes first, each with a bar of their share of that superlative's votes.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronLeft, Trophy } from "lucide-react";
import { riseChild, staggerParent } from "@/lib/motion";
import { SUPERLATIVES_TITLE, superlativeLeaders } from "@/lib/surveys/superlative-values";
import type { SuperlativeResult } from "@/lib/surveys/superlatives";
import { surveyMonth } from "@/lib/surveys/survey-values";

export function SuperlativeResultView({ survey }: { survey: SuperlativeResult }) {
  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-2">
        <Link
          href="/survey-results"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Survey Results
        </Link>
        <h1 className="text-3xl font-medium tracking-tight">
          {surveyMonth(survey.startDate)} {SUPERLATIVES_TITLE}
        </h1>
        <p className="text-sm text-muted-foreground">
          {survey.responses} of {survey.assigned} voted
          {survey.unassigned && " · unassigned, so hidden from the class"}
        </p>
      </motion.div>

      <motion.ul variants={staggerParent(0.03)} className="grid gap-4 lg:grid-cols-2">
        {survey.superlatives.map((x) => {
          const leaders = superlativeLeaders(x.standings);
          const leading = new Set(leaders.map((l) => l.email));
          return (
            <motion.li key={x.id} variants={riseChild} className="space-y-4 rounded-2xl border bg-card px-5 py-4 shadow-sm">
              <div className="space-y-1">
                <p className="font-medium">{x.title}</p>
                <p className="text-xs text-muted-foreground">
                  {x.votes} {x.votes === 1 ? "vote" : "votes"}
                </p>
              </div>
              {leaders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No votes yet.</p>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <Trophy className="mt-0.5 size-5 shrink-0 text-brand" />
                    <div>
                      <p className="text-lg font-medium">{leaders.map((l) => l.fullName).join(" & ")}</p>
                      <p className="text-xs text-muted-foreground">
                        {leaders.length > 1 ? "Tied on " : ""}
                        {leaders[0]!.votes} {leaders[0]!.votes === 1 ? "vote" : "votes"}
                      </p>
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {x.standings.map((s) => (
                      <li key={s.email} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className={leading.has(s.email) ? "font-medium" : undefined}>{s.fullName}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{s.votes}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-brand" style={{ width: `${(s.votes / x.votes) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </motion.li>
          );
        })}
      </motion.ul>
    </motion.div>
  );
}

"use client";

/**
 * One daily survey's results: each session it asked about with its average
 * rating, which opens on its rating breakdown and its comments, then
 * everyone who answered. A response opens with every answer they gave, their
 * feedback on each session included. An administrator's Generate AI Summary
 * has Claude summarize each session, shown at the top of its accordion.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft, Loader2, Sparkles } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { noticeDialog } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SurveyResponseSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { SurveyResponseRow, SurveyResult } from "@/lib/surveys/surveys";
import { SURVEY_QUESTIONS, formatAverage, surveyDate, surveyGroupLabel, surveyMonth, surveySessionLine } from "@/lib/surveys/survey-values";
import { SessionAccordion } from "./session-accordion";

const SUMMARY_ERRORS: Record<string, string> = {
  no_responses: "No one has answered this survey yet, so there is nothing to summarize.",
  unconfigured: "Claude is not set up on this deployment (no ANTHROPIC_API_KEY).",
  upstream: "Claude could not write the summary. Try again in a minute.",
  not_found: "This survey no longer exists.",
};

export function SurveyResultView({
  survey,
  query,
  page,
  canSummarize,
}: {
  survey: SurveyResult;
  query: ListQuery<SurveyResponseSort>;
  page: Page<SurveyResponseRow>;
  canSummarize: boolean;
}) {
  const router = useRouter();
  const [summarizing, setSummarizing] = useState(false);
  const rowLink = useRowLink();
  const sortProps = { sort: query.sort, dir: query.dir };
  const [open, setOpen] = useState<SurveyResponseRow | null>(null);

  async function summarize() {
    setSummarizing(true);
    try {
      const res = await fetch(`/api/survey-results/${survey.id}/summary`, { method: "POST" });
      if (res.ok) {
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => null);
      await noticeDialog({
        title: "No summary",
        description: SUMMARY_ERRORS[body?.error ?? ""] ?? `The summary failed (${res.status}).`,
      });
    } catch {
      await noticeDialog({ title: "No summary", description: "Could not reach the server." });
    } finally {
      setSummarizing(false);
    }
  }

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-medium tracking-tight">
            {surveyMonth(survey.startDate)} {surveyGroupLabel(survey.stage, survey.audience)}, Day {survey.day}
          </h1>
          {canSummarize && (
            <Button variant="outline" disabled={summarizing || survey.responses === 0} onClick={() => void summarize()}>
              {summarizing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {summarizing ? "Generating…" : "Generate AI Summary"}
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {surveyDate(survey.date)} · {survey.responses} of {survey.assigned} answered · day overall{" "}
          <span className="font-medium text-foreground tabular-nums">{formatAverage(survey.average)}</span> out of 5
          {survey.summarizedAt && <> · AI summary {new Date(survey.summarizedAt).toLocaleString()}</>}
        </p>
      </motion.div>

      <motion.div variants={riseChild}>
        <SessionAccordion surveyId={survey.id} sessions={survey.sessions} />
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by name or email" label="Search responses" className="max-w-md" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="fullName" {...sortProps}>
                  Name
                </SortHeader>
                <SortHeader column="dayRating" {...sortProps} className="w-28">
                  Day
                </SortHeader>
                <PlainHeader>What they would change</PlainHeader>
                <SortHeader column="submittedAt" {...sortProps} className="w-44">
                  Answered
                </SortHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No responses match that search." : "No responses yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((r) => (
                <tr key={r.id} className={LINK_ROW} onClick={rowLink(() => setOpen(r))}>
                  <td className="px-5 py-3">
                    <button type="button" className="text-left font-medium group-hover:underline" onClick={() => setOpen(r)}>
                      {r.fullName || r.email}
                    </button>
                    {r.fullName && <p className="text-xs text-muted-foreground">{r.email}</p>}
                  </td>
                  <td className="px-5 py-3 tabular-nums">{r.dayRating}</td>
                  <td className="max-w-md px-5 py-3 text-muted-foreground">
                    <p className="line-clamp-2">{r.dayChange || "—"}</p>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground tabular-nums">{new Date(r.submittedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} noun="responses" />
      </motion.div>

      <ResponseDialog survey={survey} response={open} onClose={() => setOpen(null)} />
    </motion.div>
  );
}

function ResponseDialog({ survey, response, onClose }: { survey: SurveyResult; response: SurveyResponseRow | null; onClose: () => void }) {
  return (
    <Dialog open={response !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {response && (
          <>
            <DialogHeader>
              <DialogTitle>{response.fullName || response.email}</DialogTitle>
              <DialogDescription>
                {surveyGroupLabel(survey.stage, survey.audience)}, Day {survey.day} · answered{" "}
                {new Date(response.submittedAt).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <div className="divide-y overflow-hidden rounded-xl border">
              {survey.sessions.map((s) => {
                const answer = response.sessions[s.id];
                return (
                  <div key={s.id} className="space-y-1.5 px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          {s.emoji && <span className="mr-1.5">{s.emoji}</span>}
                          {s.name}
                        </p>
                        <p className="text-xs text-muted-foreground">{surveySessionLine(s)}</p>
                      </div>
                      <Score value={answer?.rating} />
                    </div>
                    <Said text={answer?.feedback} />
                  </div>
                );
              })}
              <div className="space-y-1.5 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">The day overall</p>
                  <Score value={response.dayRating} />
                </div>
                <p className="text-xs text-muted-foreground">{SURVEY_QUESTIONS.dayChange}</p>
                <Said text={response.dayChange} />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Score({ value }: { value: number | undefined }) {
  return <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums">{value ?? "—"} / 5</span>;
}

function Said({ text }: { text: string | undefined }) {
  return text ? <p className="text-sm whitespace-pre-line">{text}</p> : <p className="text-sm text-muted-foreground">No comment.</p>;
}

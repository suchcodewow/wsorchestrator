"use client";

/**
 * One class as a manager sees it, BTC or INT: the day, the overall score, the
 * overall feedback, exam average and any other notes, and each exercise's
 * score with the feedback a 4, 2 or 1 carries, on Reporting → Live Sessions.
 * Only the overall score names the scale's top. A collapsible one, as BTC is
 * once someone has been to INT, starts closed on its score and day.
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BOOTCAMP_SCORE } from "@/db/schema";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { BootcampLevel, ClassSummary } from "@/lib/reporting/bootcamp-values";
import { cn } from "@/lib/utils";
import { formatDate, formatWholeScore } from "../../cohort-settings/format";

export const TRACK_LABELS = {
  sales: "Sales",
  engineer: "Engineer",
  ignored: "Ignored title",
  exempt: "Exempt",
  deferred: "Deferred",
} as const;

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm wrap-break-word">{children}</dd>
    </div>
  );
}

/** A score with its bar: a column at the card's left, half as wide as the bars once inset from both sides. */
const SCORE_COLUMN = "sm:w-[calc(50%-4rem)]";

export function ClassCard({
  name,
  summary,
  whole = false,
  collapsible = false,
}: {
  name: string;
  summary: ClassSummary;
  /** Rounds every score to a whole number, as a manager sees them. */
  whole?: boolean;
  /** Starts closed, showing only the class, its overall score and its day; opened, it shows the rest. */
  collapsible?: boolean;
}) {
  const { date, exercises, examAverage } = summary;
  const shown = (n: number | null) => (whole && n !== null ? Math.round(n) : n);
  const score = shown(summary.score);
  const [open, setOpen] = useState(!collapsible);
  const toggle = () => setOpen((was) => !was);
  const bodyId = `class-${name.toLowerCase()}`;

  return (
    <section className="flex flex-col gap-3 px-5 py-3">
      <div
        onClick={collapsible ? toggle : undefined}
        className={cn(
          "flex items-start justify-between gap-4",
          collapsible && "-mx-5 -my-3 cursor-pointer px-5 py-3 transition-colors hover:bg-muted/30",
        )}
      >
        <div className="flex items-start gap-2">
          {collapsible && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={`${name} details`}
              onClick={(ev) => {
                ev.stopPropagation();
                toggle();
              }}
              className="-mx-1 mt-1.5 cursor-pointer rounded-md px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
            </button>
          )}
          <h2 className="text-2xl font-medium tracking-tight">{name}</h2>
        </div>
        <div className="flex items-baseline gap-4">
          {!open && (
            <span className="text-2xl font-medium tabular-nums">
              {formatWholeScore(score)}
              {score !== null && <span className="text-sm text-muted-foreground"> / {BOOTCAMP_SCORE.max}</span>}
            </span>
          )}
          {date ? (
            <span className="text-sm tabular-nums text-muted-foreground">{formatDate(date)}</span>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Not attended
            </Badge>
          )}
        </div>
      </div>

      {open && (
        <div id={bodyId} className="flex flex-col gap-3">
          <div className={cn("space-y-1.5", SCORE_COLUMN)}>
            <div className="flex items-baseline justify-between text-lg font-medium">
              <span>Overall Score</span>
              <span className="tabular-nums">
                {formatWholeScore(score)}
                {score !== null && <span className="text-sm text-muted-foreground"> / {BOOTCAMP_SCORE.max}</span>}
              </span>
            </div>
            <ScoreBar score={score} />
          </div>

          <FeedbackPanel label="Overall Positive Feedback" text={summary.positiveFeedback} />
          <FeedbackPanel label="Overall Constructive Feedback" text={summary.constructiveFeedback} />
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-muted-foreground">Average exam score</span>
            <span className="tabular-nums">{examAverage === null ? "—" : `${Math.round(examAverage)}%`}</span>
          </div>
          {summary.otherNotes && <FeedbackPanel label="Other Notes" text={summary.otherNotes} />}

          {exercises.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <h3 className="text-xs text-muted-foreground">Score Breakdown</h3>
              <ul className="space-y-2">
                {exercises.map((exercise, i) => (
                  <li key={`${exercise.name}-${i}`} className="space-y-1">
                    <div className={cn("space-y-1", SCORE_COLUMN)}>
                      <div className="flex items-baseline justify-between gap-4 text-sm">
                        <span className="min-w-0 wrap-break-word">{exercise.name}</span>
                        <span className="tabular-nums">{formatWholeScore(shown(exercise.score))}</span>
                      </div>
                      <ScoreBar score={shown(exercise.score)} thin />
                    </div>
                    {exercise.feedback && (
                      <p className="pt-0.5 text-sm whitespace-pre-line text-muted-foreground wrap-break-word">
                        {exercise.feedback}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Overall feedback as a manager reads it, across the card's width. */
function FeedbackPanel({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs text-muted-foreground">{label}</h3>
      <p className={cn("text-sm whitespace-pre-line wrap-break-word", !text && "text-muted-foreground")}>{text || "—"}</p>
    </div>
  );
}

/** How far a score sits between nothing and the top of the scale. */
export function ScoreBar({ score, thin = false }: { score: number | null; thin?: boolean }) {
  const pct = score === null ? 0 : Math.max(0, Math.min(1, score / BOOTCAMP_SCORE.max)) * 100;
  return (
    <div className={cn("overflow-hidden rounded-full bg-muted", thin ? "h-1" : "h-1.5")}>
      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The furthest class someone has been to, as a chip: Intermediate in green, Bootcamp in blue. */
export function LevelChip({ level }: { level: BootcampLevel }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent",
        level === "intermediate"
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"
          : "bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300",
      )}
    >
      {STAGE_LABELS[level]}
    </Badge>
  );
}

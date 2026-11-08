"use client";

/**
 * The lines under Bootcamp on a person's Live Sessions card, for an
 * Assessments Viewer: their Diagnostic placements, and how far they are
 * through Coach Canary's videos and topics. Each is closed on a summary and
 * opens to the detail behind it. Read only; the Diagnostic's Records is
 * where a score is reset.
 */

import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { LevelBadge } from "@/app/(app)/diagnostic/level-badge";
import { ShapeCard } from "@/app/(app)/diagnostic-settings/records/person-view";
import { SUBJECTS, bandOf } from "@/lib/iris/subjects";
import type {
  PersonCoachCanary,
  PersonDiagnostic,
} from "@/lib/reporting/person-training";
import { cn } from "@/lib/utils";

/** A line that opens on click: a title and its summary, with the detail beneath once open. */
function OpenLine({
  title,
  summary,
  below,
  children,
}: {
  title: string;
  /** On the title's row, at the right. */
  summary: React.ReactNode;
  /** On a row of its own under the title, still part of what opens the line. */
  below?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = `training-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section className="flex flex-col gap-3 px-5 py-3">
      <div
        onClick={() => setOpen((was) => !was)}
        className="-mx-5 -my-3 flex cursor-pointer flex-col gap-2 px-5 py-3 transition-colors hover:bg-muted/30"
      >
        <div className="flex items-center justify-between gap-x-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={`${title} details`}
              onClick={(ev) => {
                ev.stopPropagation();
                setOpen((was) => !was);
              }}
              className="-mx-1 cursor-pointer rounded-md px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform",
                  open && "rotate-90",
                )}
              />
            </button>
            <h2 className="text-2xl font-medium tracking-tight">{title}</h2>
          </div>
          {summary}
        </div>
        {below}
      </div>
      {open && (
        <div id={bodyId} className="pt-3">
          {children}
        </div>
      )}
    </section>
  );
}

export function DiagnosticLine({
  diagnostic,
}: {
  diagnostic: PersonDiagnostic;
}) {
  const placed = new Map(
    diagnostic.sittings.map((s) => [s.subject, s.placement]),
  );
  return (
    <OpenLine
      title="Diagnostic"
      summary={
        diagnostic.composite !== null && (
          <span className="whitespace-nowrap">
            <span className="text-2xl font-medium tabular-nums">
              {diagnostic.composite}
            </span>{" "}
            <span className="text-xs text-muted-foreground">
              {bandOf(diagnostic.composite)}
            </span>
          </span>
        )
      }
      below={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-sm">
          {[...placed].map(([subject, level]) => (
            <span key={subject} className="inline-flex items-center gap-1.5">
              <span className="text-muted-foreground">
                {SUBJECTS[subject].short}
              </span>
              <LevelBadge level={level} />
            </span>
          ))}
        </span>
      }
    >
      <ShapeCard
        detail={{ name: diagnostic.name, sittings: diagnostic.sittings }}
        summary={diagnostic.summary}
      />
    </OpenLine>
  );
}

/** A circle that fills with how much is done, its count written inside. */
function CountRing({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  const size = 44;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        role="img"
        aria-label={`${label}: ${done} of ${total}`}
        className="relative inline-flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          aria-hidden
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            className="stroke-brand"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
          />
        </svg>
        <span
          className="absolute text-[11px] font-medium tabular-nums"
          aria-hidden
        >
          {done}/{total}
        </span>
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

function Mark({ done, label }: { done: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span
        className={cn(
          "inline-flex size-4 items-center justify-center rounded-full border",
          done &&
            "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        )}
      >
        {done && <Check className="size-3" strokeWidth={3} aria-hidden />}
      </span>
      <span className={cn(!done && "opacity-60")}>
        {label}
        <span className="sr-only">{done ? ": done" : ": not done"}</span>
      </span>
    </span>
  );
}

export function CoachCanaryLine({ canary }: { canary: PersonCoachCanary }) {
  return (
    <OpenLine
      title="Coach Canary"
      summary={
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <CountRing
            done={canary.videos.watched}
            total={canary.videos.total}
            label="Videos watched"
          />
          <CountRing
            done={canary.topics.mastered}
            total={canary.topics.total}
            label="Topics mastered"
          />
        </div>
      }
    >
      <div className="grid gap-6 md:grid-cols-3">
        {canary.levels.map((level) => (
          <div key={level.level} className="min-w-0 space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              {level.level * 100} · {level.name}
            </h3>
            <ul className="divide-y rounded-lg border text-sm">
              {level.topics.length === 0 && (
                <li className="px-3 py-1.5 text-muted-foreground">
                  No topics.
                </li>
              )}
              {level.topics.map((topic) => (
                <li key={topic.id} className="space-y-1 px-3 py-1.5">
                  <p className="wrap-break-word">{topic.name}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {topic.hasVideo && (
                      <Mark done={topic.watched} label="Watched" />
                    )}
                    <Mark done={topic.mastered} label="Mastered" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </OpenLine>
  );
}

"use client";

/**
 * One class as a manager sees it, BTC or INT: the day, the overall score and
 * each exercise's. Shared by Reporting → Bootcamp and Cohorts → Previous.
 */

import { Badge } from "@/components/ui/badge";
import { BOOTCAMP_SCORE } from "@/db/schema";
import { isExempt, type ClassSummary } from "@/lib/reporting/bootcamp-values";
import { cn } from "@/lib/utils";
import { formatDate, formatScore } from "../../cohort-settings/format";

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

export function ClassCard({ name, code, summary }: { name: string; code: string; summary: ClassSummary }) {
  const { date, score, exercises } = summary;

  return (
    <section className="flex flex-col gap-5 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">{name}</h2>
          <p className="text-xs text-muted-foreground">{code}</p>
        </div>
        {isExempt(date) ? (
          <Badge variant="secondary">Exempt</Badge>
        ) : date ? (
          <span className="text-sm tabular-nums text-muted-foreground">{formatDate(date)}</span>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Not attended
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Overall score</span>
          <span className="text-2xl font-medium tabular-nums">
            {formatScore(score)}
            {score !== null && <span className="text-sm text-muted-foreground"> / {BOOTCAMP_SCORE.max}</span>}
          </span>
        </div>
        <ScoreBar score={score} />
      </div>

      {exercises.length > 0 && (
        <div className="space-y-3 border-t pt-4">
          <h3 className="text-xs text-muted-foreground">By exercise</h3>
          <ul className="space-y-3">
            {exercises.map((exercise, i) => (
              <li key={`${exercise.name}-${i}`} className="space-y-1">
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="min-w-0 wrap-break-word">{exercise.name}</span>
                  <span className="tabular-nums">{formatScore(exercise.score)}</span>
                </div>
                <ScoreBar score={exercise.score} thin />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
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

/** The furthest class someone has been to, as a chip: INT in green, BTC in blue. */
export function LevelChip({ level }: { level: "intermediate" | "bootcamp" | "exempt" }) {
  if (level === "exempt") return <Badge variant="secondary">Exempt</Badge>;
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
      {level === "intermediate" ? "INT" : "BTC"}
    </Badge>
  );
}

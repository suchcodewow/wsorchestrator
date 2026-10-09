"use client";

/**
 * A rep's last six months at a glance: a dot a month beside their name,
 * oldest on the left, coloured by how much of that month's lineup they
 * finished. Hovering opens the months in full.
 *
 * Always the six months to now, not the month picked: the dots answer "is
 * this person keeping up?", which the month on screen doesn't change.
 */

import type { MonthMark, RepTrends } from "@/lib/canary-wire/history";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Green only for everything done; amber from half; red below. */
function tone(mark: MonthMark): { dot: string; bar: string; text: string } {
  if (mark.exempt) return { dot: "border-[1.5px] border-dashed border-muted-foreground/50", bar: "", text: "text-muted-foreground" };
  if (mark.pct === null) return { dot: "border-[1.5px] border-muted-foreground/30", bar: "", text: "text-muted-foreground" };
  if (mark.pct >= 100) return { dot: "bg-emerald-500", bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" };
  if (mark.pct >= 50) return { dot: "bg-amber-400", bar: "bg-amber-400", text: "text-amber-600 dark:text-amber-400" };
  return { dot: "bg-red-500", bar: "bg-red-500", text: "text-red-600 dark:text-red-400" };
}

/** "October 2026" → "Oct". */
const short = (month: string) => month.slice(0, 3);

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** The line under the months: when they last finished something, and what is still open. */
function summary(marks: MonthMark[], lastCompleted: string): string {
  const counted = marks.filter((m) => !m.exempt && m.assigned > 0);
  if (!counted.length) return "Not counted in any of these months yet.";
  const open = (ms: MonthMark[]) => ms.filter((m) => !m.exempt).reduce((n, m) => n + Math.max(m.assigned - m.completed, 0), 0);
  const all = open(marks);
  if (!all) return "Finished everything they owed in these months.";
  const recent = open(marks.slice(-2));
  const last = lastCompleted ? `Last finished a module ${lastCompleted.replace(/, \d{4}$/, "")}.` : "Nothing finished in these months.";
  const tail = !recent ? "." : recent === all ? ", all from the last two months." : `, ${recent} of them from the last two months.`;
  return `${last} ${plural(all, "module")} still open${tail}`;
}

export function Trend({
  name,
  email,
  trends,
  month,
}: {
  name: string;
  email: string;
  trends: RepTrends;
  /** The month on screen, picked out in the card. */
  month: string;
}) {
  const rep = trends.reps[email];
  if (!rep || !trends.months.length) return null;
  const { marks, lastCompleted } = rep;
  const counted = marks.filter((m) => !m.exempt && m.assigned > 0);
  const done = counted.reduce((n, m) => n + m.completed, 0);
  const owed = counted.reduce((n, m) => n + m.assigned, 0);
  const overall: MonthMark = { pct: owed ? Math.round((done / owed) * 100) : null, completed: done, assigned: owed, exempt: false };
  const months = trends.months;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${name}'s last ${months.length} months`}
          className="inline-flex shrink-0 cursor-help items-center gap-1 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {marks.map((m, i) => (
            <i key={months[i]} className={cn("block size-2.5 rounded-full", tone(m).dot)} />
          ))}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="w-72 max-w-none rounded-xl p-4 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-medium">{name}</span>
          {overall.pct !== null && <span className={cn("font-medium tabular-nums", tone(overall).text)}>{overall.pct}%</span>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {owed
            ? `Finished ${done} of ${owed} assigned, ${short(months[0]!)} to ${short(months.at(-1)!)}`
            : `${short(months[0]!)} to ${short(months.at(-1)!)}`}
        </p>
        <ul className="mt-3 space-y-1.5">
          {marks.map((m, i) => {
            const t = tone(m);
            const here = months[i] === month;
            return (
              <li key={months[i]} className={cn("grid grid-cols-[2.25rem_1fr_3.5rem] items-center gap-2 text-xs", here && "font-medium")}>
                <span className={here ? "text-foreground" : "text-muted-foreground"} title={months[i]}>
                  {short(months[i]!)}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  {t.bar && <i className={cn("block h-full rounded-full", t.bar)} style={{ width: `${Math.max(m.pct ?? 0, 4)}%` }} />}
                </span>
                <span className={cn("text-right tabular-nums", m.exempt || m.pct === null ? "text-muted-foreground" : "text-foreground")}>
                  {m.exempt ? "Not yet" : m.assigned ? `${m.completed}/${m.assigned}` : "—"}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">{summary(marks, lastCompleted)}</p>
      </TooltipContent>
    </Tooltip>
  );
}

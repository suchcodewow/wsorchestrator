"use client";

/** One person's sittings: the path each took through the levels, how each level did against the bar, and every answer. */

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { HEADER_ROW, PlainHeader } from "@/components/data-table";
import type { CohortSummary, DetailAnswer, DetailSitting, PersonDetail } from "@/lib/iris/cohort";
import { ENGINE, LEVELS, type Level } from "@/lib/iris/engine";
import { LEVEL_LABELS, SUBJECTS, SUBJECT_KEYS, TRACK_LABELS, TRAINING, bandOf } from "@/lib/iris/subjects";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { LevelBadge } from "../../level-badge";
import { Radar } from "../../radar";
import { ClearResultsButton } from "./clear-results-button";

type Sitting = Omit<DetailSitting, "startedAt" | "finishedAt"> & { startedAt: string; finishedAt: string | null };
type Detail = Omit<PersonDetail, "sittings"> & { sittings: Sitting[] };

const LETTERS = "ABCD";

export function PersonView({ detail, summary }: { detail: Detail; summary: CohortSummary }) {
  const who = detail.name || detail.email || "This person";
  const finished = detail.sittings.filter((s) => s.finishedAt).length;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild}>
        <Link href="/iris/cohort" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Cohort
        </Link>
      </motion.div>

      <motion.div variants={riseChild} className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">{who}</h2>
          <p className="text-sm text-muted-foreground tnum">
            {detail.name && detail.email && <>{detail.email} · </>}
            {detail.track ? TRACK_LABELS[detail.track] : "No track"} · {finished} of {SUBJECT_KEYS.length} done
            {detail.composite !== null && (
              <>
                {" "}
                · overall {detail.composite}, {bandOf(detail.composite)}
              </>
            )}
          </p>
        </div>
        <ClearResultsButton userId={detail.userId} who={who} sittings={detail.sittings.length} />
      </motion.div>

      {finished > 0 && (
        <motion.div variants={riseChild}>
          <ShapeCard detail={detail} summary={summary} />
        </motion.div>
      )}

      {detail.sittings.length === 0 && (
        <motion.p variants={riseChild} className="text-sm text-muted-foreground">
          No sittings on this form.
        </motion.p>
      )}

      {detail.sittings.map((s) => (
        <motion.div key={s.subject} variants={riseChild}>
          <SittingCard sitting={s} />
        </motion.div>
      ))}
    </motion.div>
  );
}

/** Where this person sits in every subject, against the middle of the whole cohort. */
function ShapeCard({ detail, summary }: { detail: Detail; summary: CohortSummary }) {
  const placed = new Map(
    detail.sittings.filter((s) => s.finishedAt && s.placement).map((s) => [s.subject, s.placement as Level]),
  );
  const values = SUBJECT_KEYS.map((k) => placed.get(k) ?? null);
  const medians = SUBJECT_KEYS.map((k) => summary.subjects[k].median);

  return (
    <div className="grid gap-6 overflow-hidden rounded-2xl border bg-card p-5 text-sm shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-center">
      <div className="mx-auto w-full max-w-md px-6">
        <Radar
          axes={SUBJECT_KEYS.map((k) => SUBJECTS[k].short)}
          series={[
            { values: medians, variant: "median" },
            { values, variant: "person" },
          ]}
          showRingLabels
          label={`${detail.name || "This person"}'s placement in each subject, against the cohort median`}
        />
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-brand" /> This person
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3.5 border-t-2 border-dashed border-muted-foreground" /> Cohort median, {summary.people}{" "}
            {summary.people === 1 ? "person" : "people"}
          </span>
        </div>
        <div className="divide-y rounded-lg border">
          {SUBJECT_KEYS.map((k) => {
            const mine = placed.get(k);
            const median = summary.subjects[k].median;
            return (
              <div key={k} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className={mine ? "" : "text-muted-foreground"}>{SUBJECTS[k].short}</span>
                <span className="flex items-center gap-2">
                  {mine ? <LevelBadge level={mine} /> : <span className="text-xs text-muted-foreground">Not taken</span>}
                  <span className="w-32 text-right text-xs whitespace-nowrap text-muted-foreground">
                    {median ? `cohort ${LEVEL_LABELS[median]}` : "—"}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SittingCard({ sitting }: { sitting: Sitting }) {
  return (
    <div className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
        <p className="font-medium">{SUBJECTS[sitting.subject].name}</p>
        {sitting.placement && sitting.finishedAt ? (
          <LevelBadge level={sitting.placement as Level} />
        ) : (
          <span className="text-xs text-muted-foreground">In progress</span>
        )}
        <span className="text-muted-foreground tnum">
          {sitting.answers.length} questions
          {sitting.confidence && <> · {sitting.confidence} confidence</>}
          {sitting.finishedAt && <> · {new Date(sitting.finishedAt).toLocaleDateString()}</>}
        </span>
      </div>

      {sitting.answers.length > 0 && (
        <div className="space-y-4 px-5 py-4">
          <PathChart answers={sitting.answers} />
          <Tally answers={sitting.answers} placement={sitting.finishedAt ? (sitting.placement as Level | null) : null} />
        </div>
      )}

      {sitting.placement && sitting.finishedAt && (
        <div className="px-5 py-4">
          <p className="text-xs font-medium text-muted-foreground">
            Routes to · {LEVEL_LABELS[sitting.placement as Level]} tier
          </p>
          <p className="mt-1">{TRAINING[sitting.subject][sitting.placement as Level]}</p>
        </div>
      )}

      {sitting.answers.length > 0 && <AnswerTable answers={sitting.answers} />}
    </div>
  );
}

/** The run as a staircase: x is question order, y the level each question was drawn at. */
function PathChart({ answers }: { answers: DetailAnswer[] }) {
  const n = answers.length;
  const W = 640;
  const H = 150;
  const L = 96;
  const R = 14;
  const T = 14;
  const B = 28;
  const pw = W - L - R;
  const ph = H - T - B;
  const y = (lv: number) => T + ph - ((lv - 1) / 2) * ph;
  const x = (i: number) => (n === 1 ? L + pw / 2 : L + (i / (n - 1)) * pw);

  let d = `M ${x(0)} ${y(answers[0]!.level)}`;
  for (let i = 1; i < n; i++) d += ` L ${x(i)} ${y(answers[i - 1]!.level)} L ${x(i)} ${y(answers[i]!.level)}`;
  const firstTie = answers.findIndex((a) => a.phase === "tiebreak");

  return (
    <figure className="space-y-2">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-120 text-muted-foreground"
          role="img"
          aria-label="Question by question path through the levels"
        >
          {LEVELS.map((lv) => (
            <g key={lv}>
              <line x1={L} x2={W - R} y1={y(lv)} y2={y(lv)} className="stroke-border" strokeDasharray="2 4" />
              <text x={L - 10} y={y(lv) + 4} textAnchor="end" className="fill-current text-[11px]">
                {LEVEL_LABELS[lv]}
              </text>
            </g>
          ))}
          {firstTie > 0 && (
            <g>
              <line
                x1={(x(firstTie - 1) + x(firstTie)) / 2}
                x2={(x(firstTie - 1) + x(firstTie)) / 2}
                y1={T - 4}
                y2={T + ph + 6}
                className="stroke-amber-500/60"
                strokeDasharray="3 3"
              />
              <text x={(x(firstTie - 1) + x(firstTie)) / 2} y={T - 2} textAnchor="middle" className="fill-current text-[10px]">
                tiebreak
              </text>
            </g>
          )}
          <path d={d} fill="none" className="stroke-brand" strokeWidth={1.75} />
          {answers.map((a, i) => (
            <g key={a.seq}>
              <circle
                cx={x(i)}
                cy={y(a.level)}
                r={4.5}
                className={a.correct ? "fill-emerald-500" : "fill-card stroke-rose-500"}
                strokeWidth={a.correct ? 0 : 1.75}
              />
              <text x={x(i)} y={T + ph + 18} textAnchor="middle" className="fill-current text-[10px]">
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-emerald-500" /> Right
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-[1.5px] border-rose-500" /> Missed or didn&apos;t know
        </span>
        <span>Two right in a row moves up, two wrong moves down.</span>
      </figcaption>
    </figure>
  );
}

/** Each level against the bar: placement is the highest with 3 or more asked and two thirds right. */
function Tally({ answers, placement }: { answers: DetailAnswer[]; placement: Level | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-120 text-sm">
        <thead>
          <tr className={HEADER_ROW}>
            <PlainHeader>Level</PlainHeader>
            <PlainHeader>Asked</PlainHeader>
            <PlainHeader>Right</PlainHeader>
            <PlainHeader>Accuracy</PlainHeader>
            <PlainHeader>Against the bar</PlainHeader>
          </tr>
        </thead>
        <tbody>
          {([3, 2, 1] as const).map((lv) => {
            const at = answers.filter((a) => a.level === lv);
            const right = at.filter((a) => a.correct).length;
            const accuracy = at.length ? Math.round((right / at.length) * 100) : null;
            const clears = at.length >= ENGINE.MIN_AT_LEVEL && right / at.length >= ENGINE.BAR;
            return (
              <tr key={lv} className={cn("border-b last:border-b-0", placement === lv && "bg-brand-subtle/50")}>
                <td className="px-5 py-2">{LEVEL_LABELS[lv]}</td>
                <td className="px-5 py-2 tnum">{at.length}</td>
                <td className="px-5 py-2 tnum">{right}</td>
                <td className="px-5 py-2 tnum">{accuracy === null ? "—" : `${accuracy}%`}</td>
                <td className="px-5 py-2 text-muted-foreground">
                  {at.length < ENGINE.MIN_AT_LEVEL ? "Too few asked" : clears ? "Clears the bar" : "Below the bar"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AnswerTable({ answers }: { answers: DetailAnswer[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-200 text-sm">
        <thead>
          <tr className={HEADER_ROW}>
            <PlainHeader>#</PlainHeader>
            <PlainHeader>Level</PlainHeader>
            <PlainHeader>Question</PlainHeader>
            <PlainHeader>Their answer</PlainHeader>
            <PlainHeader>Result</PlainHeader>
            <PlainHeader>Time</PlainHeader>
          </tr>
        </thead>
        <tbody>
          {answers.map((a) => (
            <tr key={a.seq} className="border-b align-top last:border-b-0">
              <td className="px-5 py-3 text-muted-foreground tnum">{a.seq}</td>
              <td className="px-5 py-3">
                <LevelBadge level={a.level} />
                {a.phase === "tiebreak" && <span className="mt-1 block text-xs text-muted-foreground">tiebreak</span>}
              </td>
              <td className="max-w-md px-5 py-3">
                {a.stem ?? <span className="text-muted-foreground">An earlier version of {a.itemId}</span>}
                <span className="mt-1 block font-mono text-xs text-muted-foreground">{a.itemId}</span>
              </td>
              <td className="max-w-xs px-5 py-3">
                {a.chosen ? (
                  <>
                    <span className="font-mono text-xs text-muted-foreground">{LETTERS[a.chosen.index]}.</span>{" "}
                    {a.chosen.text ?? ""}
                  </>
                ) : (
                  <span className="text-muted-foreground">I don&apos;t know</span>
                )}
              </td>
              <td
                className={cn(
                  "px-5 py-3 whitespace-nowrap",
                  a.correct ? "text-emerald-700 dark:text-emerald-400" : a.chosen ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground",
                )}
              >
                {a.correct ? "Right" : a.chosen ? "Missed" : "Didn't know"}
              </td>
              <td className="px-5 py-3 text-muted-foreground tnum">{Math.round(a.ms / 1000)}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";

/**
 * Everything Assessments sees behind a person's INT and BTC: each assessment,
 * by class, with every criterion's score and comment and both feedback boxes.
 * With Edit on, an Assessments Administrator corrects any of it in place, one
 * assessment at a time; one with no criteria, as the old bootcamp history
 * left, has its score set directly.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BOOTCAMP_SCORE, EVALS_ASSESSMENT_LIMITS } from "@/db/schema";
import {
  CONSTRUCTIVE_REQUIRED_NOTE,
  CRITERION_SCORES,
  POSITIVE_REQUIRED_NOTE,
  STAGE_LABELS,
  averageScore,
  requiredFeedback,
  wholeScore,
} from "@/lib/evals/assessment-values";
import { STAGE_CODES } from "@/lib/reporting/bootcamp-values";
import { cn } from "@/lib/utils";
import { formatDate, formatScore, formatWhen } from "../../../cohort-settings/format";
import { Field } from "../class-card";
import type { ViewSubmission } from "./person-view";

const SAVE_ERRORS: Record<string, string> = {
  conflict: "Someone changed this since the page loaded. Reload to see their version.",
  feedback_required: "This average needs the feedback marked required.",
  invalid: "Something here isn't valid; check each field.",
  not_found: "This has been removed.",
};

/** Saves `body` to `url`, then reloads the page's data; returns the error to show, if any. */
function useSave() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(url: string, body: unknown): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
        setError((code && SAVE_ERRORS[code]) || `Could not save (${res.status})`);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Could not save");
      return false;
    } finally {
      setPending(false);
    }
  }

  return { save, pending, error };
}

/** One card per class someone was assessed in: INT before BTC, each newest bootcamp first, as fetched. */
export function SubmissionGroups({ submissions, editing }: { submissions: ViewSubmission[]; editing: boolean }) {
  const groups: { key: string; first: ViewSubmission; items: ViewSubmission[] }[] = [];
  const ordered = [
    ...submissions.filter((s) => s.stage === "intermediate"),
    ...submissions.filter((s) => s.stage !== "intermediate"),
  ];
  for (const s of ordered) {
    const key = `${s.bootcamp.id}:${s.stage}`;
    const group = groups.find((g) => g.key === key);
    if (group) group.items.push(s);
    else groups.push({ key, first: s, items: [s] });
  }

  return (
    <>
      {groups.map(({ key, first, items }) => {
        const average = averageScore(items.map((s) => s.averageScore));
        return (
          <div key={key} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="space-y-0.5">
                <h4 className="font-medium">
                  {STAGE_LABELS[first.stage]} · {formatDate(first.bootcamp.startDate)}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {STAGE_CODES[first.stage]} average {formatScore(average)} over {items.length}{" "}
                  {items.length === 1 ? "assessment" : "assessments"}
                </p>
              </div>
              {first.released ? (
                <Badge variant="secondary">Released to managers</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Not released
                </Badge>
              )}
            </div>
            {items.map((s) =>
              editing ? (
                <SubmissionForm key={`${s.id}:${s.updatedAt}`} submission={s} />
              ) : (
                <SubmissionRow key={s.id} submission={s} />
              ),
            )}
          </div>
        );
      })}
    </>
  );
}

function SubmissionHeading({ submission: s, average }: { submission: ViewSubmission; average: number | null }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <h5 className="font-medium wrap-break-word">{s.assessmentName}</h5>
        <p className="text-xs text-muted-foreground">
          {s.ownerName ?? "Unknown judge"} · {formatWhen(s.updatedAt)}
        </p>
      </div>
      <span className="text-xl font-medium tabular-nums">
        {formatScore(average)}
        <span className="text-sm text-muted-foreground"> / {BOOTCAMP_SCORE.max}</span>
      </span>
    </div>
  );
}

function SubmissionRow({ submission: s }: { submission: ViewSubmission }) {
  return (
    <section className="space-y-4 px-5 py-4">
      <SubmissionHeading submission={s} average={s.averageScore} />
      {s.scores.length > 0 && (
        <ul className="space-y-3">
          {s.scores.map((c) => (
            <li key={c.criterionId} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="min-w-0 wrap-break-word">{c.criterionName}</span>
                <span className="tabular-nums">{c.score}</span>
              </div>
              {c.comment && (
                <p className="whitespace-pre-line text-sm text-muted-foreground wrap-break-word">{c.comment}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {(s.positiveFeedback || s.constructiveFeedback) && (
        <dl className="grid gap-4 border-t pt-4 sm:grid-cols-2">
          <Field label="Positive feedback">
            <span className="whitespace-pre-line">{s.positiveFeedback || "—"}</span>
          </Field>
          <Field label="Constructive feedback">
            <span className="whitespace-pre-line">{s.constructiveFeedback || "—"}</span>
          </Field>
        </dl>
      )}
    </section>
  );
}

function SubmissionForm({ submission: s }: { submission: ViewSubmission }) {
  const { save, pending, error } = useSave();
  const [scores, setScores] = useState(() => s.scores.map((c) => ({ ...c })));
  const [positive, setPositive] = useState(s.positiveFeedback);
  const [constructive, setConstructive] = useState(s.constructiveFeedback);
  // An assessment with no criteria, as the old bootcamp history left, takes its score as typed.
  const direct = s.scores.length === 0;
  const [typed, setTyped] = useState(s.averageScore === null ? "" : String(s.averageScore));

  const typedScore = Number(typed);
  const typedValid =
    typed.trim() !== "" &&
    Number.isFinite(typedScore) &&
    typedScore >= BOOTCAMP_SCORE.min &&
    typedScore <= BOOTCAMP_SCORE.max &&
    Number(typedScore.toFixed(1)) === typedScore;
  const average = direct ? (typedValid ? typedScore : null) : averageScore(scores.map((c) => c.score));
  const needed = direct || average === null ? null : requiredFeedback(wholeScore(average));
  const missing =
    (direct && !typedValid) ||
    (needed === "positive" && !positive.trim()) ||
    (needed === "constructive" && !constructive.trim());
  const changed =
    positive !== s.positiveFeedback ||
    constructive !== s.constructiveFeedback ||
    (direct && typedScore !== s.averageScore) ||
    scores.some((c, i) => c.score !== s.scores[i]!.score || c.comment !== s.scores[i]!.comment);

  function set(i: number, change: Partial<{ score: number; comment: string }>) {
    setScores((all) => all.map((c, j) => (j === i ? { ...c, ...change } : c)));
  }

  return (
    <section className="space-y-4 px-5 py-4">
      <SubmissionHeading submission={s} average={average} />
      {direct && (
        <label className="flex flex-wrap items-center justify-between gap-3 text-sm">
          Score
          <Input
            type="number"
            inputMode="decimal"
            min={BOOTCAMP_SCORE.min}
            max={BOOTCAMP_SCORE.max}
            step={0.1}
            value={typed}
            aria-invalid={!typedValid}
            onChange={(e) => setTyped(e.target.value)}
            className="w-24 shrink-0"
          />
        </label>
      )}
      <ul className="space-y-4">
        {scores.map((c, i) => (
          <li key={c.criterionId} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 text-sm wrap-break-word">{c.criterionName}</span>
              <div role="radiogroup" aria-label={`Score for ${c.criterionName}`} className="flex gap-1.5">
                {CRITERION_SCORES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={c.score === n}
                    onClick={() => set(i, { score: n })}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-md border text-sm font-medium transition-colors",
                      c.score === n
                        ? "border-brand bg-brand text-brand-foreground"
                        : "border-input bg-field hover:bg-muted/50",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <Textarea
              aria-label={`Comment on ${c.criterionName}`}
              placeholder="Comment (optional)"
              value={c.comment}
              maxLength={EVALS_ASSESSMENT_LIMITS.comment}
              onChange={(e) => set(i, { comment: e.target.value })}
              className="min-h-14"
            />
          </li>
        ))}
      </ul>
      <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
        <FeedbackBox
          id={`${s.id}-positive`}
          label="Positive feedback"
          value={positive}
          onChange={setPositive}
          note={needed === "positive" ? POSITIVE_REQUIRED_NOTE : null}
        />
        <FeedbackBox
          id={`${s.id}-constructive`}
          label="Constructive feedback"
          value={constructive}
          onChange={setConstructive}
          note={needed === "constructive" ? CONSTRUCTIVE_REQUIRED_NOTE : null}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="brand"
          disabled={!changed || missing || pending}
          onClick={() =>
            void save(`/api/reporting/bootcamp/submissions/${s.id}`, {
              scores: scores.map(({ criterionId, score, comment }) => ({ criterionId, score, comment })),
              positiveFeedback: positive,
              constructiveFeedback: constructive,
              ...(direct && { averageScore: typedScore }),
              revises: s.updatedAt,
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
        {direct && !typedValid && (
          <p className="text-sm text-muted-foreground">
            Scores run from {BOOTCAMP_SCORE.min} to {BOOTCAMP_SCORE.max}, to one decimal place.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function FeedbackBox({
  id,
  label,
  value,
  onChange,
  note,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Set when the average makes this box required. */
  note: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {note && <span className="text-destructive"> *</span>}
      </label>
      {note && <p className="text-xs text-amber-600 dark:text-amber-500">{note}</p>}
      <Textarea
        id={id}
        value={value}
        required={note !== null}
        aria-invalid={note !== null && !value.trim()}
        maxLength={EVALS_ASSESSMENT_LIMITS.feedback}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

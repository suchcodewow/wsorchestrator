"use client";

/**
 * Scores one attendee on each criterion from 1 to 4, with an optional comment
 * on each, then the overall feedback. The average shows as a whole number and
 * decides which feedback is required; it is saved to one decimal place.
 *
 * A criterion's comment can tag, with "@", anyone who can score here. The
 * feedback cannot: it is what the attendee is sent, on Slack.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Info, Loader2, Send } from "lucide-react";
import { MentionTextarea } from "@/components/mention-textarea";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EVALS_ASSESSMENT_LIMITS } from "@/db/schema";
import {
  CONSTRUCTIVE_REQUIRED_NOTE,
  CRITERION_SCORES,
  POSITIVE_REQUIRED_NOTE,
  averageScore,
  requiredFeedback,
  wholeScore,
} from "@/lib/evals/assessment-values";
import type { ScoringForm } from "@/lib/evals/scoring";
import { mentionsIn, type MentionPick } from "@/lib/mentions";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ActiveBootcamp } from "@/lib/scheduler/bootcamps";
import { cn } from "@/lib/utils";
import { BootcampNotice } from "../../../bootcamp-notice";

type Form = Omit<ScoringForm, "submission"> & {
  submission: (Omit<NonNullable<ScoringForm["submission"]>, "updatedAt"> & { updatedAt: string }) | null;
};

/** `picks` is everyone ever picked in the comment; those its text still names are the ones sent. */
type Entry = { score: number | null; comment: string; picks: MentionPick[] };

const ERRORS: Record<string, string> = {
  invalid: "Score every criterion from 1 to 4.",
  feedback_required: "This average needs the feedback marked required.",
  not_scorer: "Someone tagged can no longer score here.",
  no_bootcamp: "No bootcamp is active, so nothing can be scored.",
  not_found: "This assessment or attendee can no longer be scored — go back to the list.",
  conflict: "Someone else saved this assessment while you had it open. Reload to see their version.",
  forbidden: "You can no longer score — reload the page.",
};

export function ScoringFormView({
  form,
  bootcamp,
  viewerId,
}: {
  form: Form;
  bootcamp: ActiveBootcamp | null;
  viewerId: string;
}) {
  const router = useRouter();
  const { assessment, criteria, attendee, submission } = form;
  const back = `/evals/${assessment.stage}/${assessment.id}`;

  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      criteria.map((c) => {
        const saved = submission?.scores[c.id];
        return [c.id, { score: saved?.score ?? null, comment: saved?.comment ?? "", picks: saved?.mentions ?? [] }];
      }),
    ),
  );
  const [positive, setPositive] = useState(submission?.positiveFeedback ?? "");
  const [constructive, setConstructive] = useState(submission?.constructiveFeedback ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scores = criteria.flatMap((c) => (entries[c.id]?.score != null ? [entries[c.id]!.score!] : []));
  const complete = scores.length === criteria.length;
  const average = averageScore(scores);
  const whole = average === null ? null : wholeScore(average);
  const needed = complete && whole !== null ? requiredFeedback(whole) : null;
  const unscored = submission ? criteria.filter((c) => !submission.scores[c.id]).length : 0;
  const ownedByOther = submission !== null && submission.ownerId !== viewerId;

  const canSubmit =
    bootcamp !== null &&
    complete &&
    !(needed === "positive" && !positive.trim()) &&
    !(needed === "constructive" && !constructive.trim());

  function set(id: string, patch: Partial<Entry>) {
    setEntries((all) => ({ ...all, [id]: { ...all[id]!, ...patch } }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/evals/scoring/${assessment.id}/${encodeURIComponent(attendee.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scores: criteria.map((c) => {
            const entry = entries[c.id]!;
            return {
              criterionId: c.id,
              score: entry.score,
              comment: entry.comment,
              mentions: mentionsIn(entry.comment, entry.picks).map((p) => p.email),
            };
          }),
          positiveFeedback: positive,
          constructiveFeedback: constructive,
          revises: submission?.updatedAt ?? null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          body?.error === "not_scorer" && body.email
            ? `${body.email} can no longer score here, so cannot be tagged.`
            : (ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`),
        );
        return;
      }
      router.push(back);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-3xl space-y-6">
      <motion.div variants={riseChild} className="space-y-4">
        <Link
          href={back}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {assessment.name}
        </Link>
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">{attendee.fullName}</h2>
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground">{attendee.email}</span>
            {attendee.title && <> · {attendee.title}</>}
          </p>
          <BootcampNotice stage={assessment.stage} bootcamp={bootcamp} />
        </div>
      </motion.div>

      {ownedByOther && (
        <motion.div
          variants={riseChild}
          role="status"
          className="flex items-start gap-2 rounded-xl border border-brand/40 bg-brand/5 px-4 py-3 text-sm"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>
            <span className="font-medium">{submission.ownerName ?? "Someone who has since left"}</span> wrote this
            assessment. Saving your changes makes you its owner.
          </span>
        </motion.div>
      )}
      {unscored > 0 && (
        <motion.p variants={riseChild} role="status" className="text-sm text-amber-600 dark:text-amber-500">
          {unscored} {unscored === 1 ? "criterion was" : "criteria were"} added since this was scored. Score{" "}
          {unscored === 1 ? "it" : "them"} to save.
        </motion.p>
      )}

      {criteria.map((c, i) => {
        const entry = entries[c.id]!;
        return (
          <motion.section key={c.id} variants={riseChild} className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
            <div className="space-y-1">
              <h3 className="font-medium">
                {i + 1}. {c.name}
              </h3>
              {c.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{c.description}</p>}
            </div>
            <div role="radiogroup" aria-label={`Score for ${c.name}`} className="flex gap-2">
              {CRITERION_SCORES.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={entry.score === n}
                  onClick={() => set(c.id, { score: n })}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-md border text-sm font-medium transition-colors",
                    entry.score === n
                      ? "border-brand bg-brand text-brand-foreground"
                      : "border-input bg-field hover:bg-muted/50",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <MentionTextarea
              aria-label={`Comment on ${c.name}`}
              placeholder={form.people.length > 0 ? "Comment (optional) — type @ to tag someone" : "Comment (optional)"}
              value={entry.comment}
              maxLength={EVALS_ASSESSMENT_LIMITS.comment}
              onChange={(comment) => set(c.id, { comment })}
              people={form.people}
              onPick={(p) => set(c.id, { picks: [...entry.picks, p] })}
              className="min-h-16"
            />
          </motion.section>
        );
      })}

      <motion.section variants={riseChild} className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-medium">Average score</h3>
          <span className="text-3xl font-medium tabular-nums" aria-live="polite">
            {whole ?? "—"}
          </span>
        </div>
        {!complete && (
          <p className="text-sm text-muted-foreground">
            {scores.length} of {criteria.length} criteria scored
          </p>
        )}

        <FeedbackBox
          id="positive-feedback"
          label="Positive Feedback"
          value={positive}
          onChange={setPositive}
          note={needed === "positive" ? POSITIVE_REQUIRED_NOTE : null}
        />
        <FeedbackBox
          id="constructive-feedback"
          label="Constructive Feedback"
          value={constructive}
          onChange={setConstructive}
          note={needed === "constructive" ? CONSTRUCTIVE_REQUIRED_NOTE : null}
        />
      </motion.section>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild}>
        <Button variant="brand" disabled={!canSubmit || busy} onClick={submit}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
          Submit
        </Button>
      </motion.div>
    </motion.div>
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
      {note && <p className="text-sm text-amber-600 dark:text-amber-500">{note}</p>}
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

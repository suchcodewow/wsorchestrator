"use client";

/**
 * A daily survey as the person it was sent to fills it in: a rating and
 * optional feedback for each session, then a rating of the day and one thing
 * they would change. The ratings are required, checked here and again by the
 * server. They can come back and change their answers at any time.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SURVEY_LIMITS } from "@/db/schema";
import { riseChild, staggerParent } from "@/lib/motion";
import { formatClock } from "@/lib/scheduler/timeline";
import type { MySurvey } from "@/lib/surveys/surveys";
import { RATINGS, RATING_LABELS, SURVEY_QUESTIONS, SURVEY_STAGE_LABELS, surveyDate } from "@/lib/surveys/survey-values";
import { cn } from "@/lib/utils";

/** Where the day's own questions are held, beside the sessions' ids. */
const DAY = "day";

const ERRORS: Record<string, string> = {
  impersonating: "You are viewing the app as someone else, so their answers cannot be changed.",
  required: "Rate every session, and the day.",
  unknown_session: "This survey has changed since you opened it. Reload the page.",
  not_found: "This survey is no longer yours to fill in.",
};

export function SurveyFiller({ survey }: { survey: MySurvey }) {
  const [ratings, setRatings] = useState<Record<string, number | undefined>>(() => {
    const saved = survey.answers;
    if (!saved) return {};
    return { ...Object.fromEntries(Object.entries(saved.sessions).map(([id, a]) => [id, a.rating])), [DAY]: saved.dayRating };
  });
  const [feedback, setFeedback] = useState<Record<string, string>>(() => {
    const saved = survey.answers;
    if (!saved) return {};
    return { ...Object.fromEntries(Object.entries(saved.sessions).map(([id, a]) => [id, a.feedback])), [DAY]: saved.dayChange };
  });
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState(survey.submittedAt);
  const [justSaved, setJustSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setJustSaved(false);
    const unrated = [...survey.sessions.map((s) => s.id), DAY].filter((id) => ratings[id] === undefined);
    setMissing(new Set(unrated));
    if (unrated.length > 0) {
      setError(ERRORS.required!);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/surveys/${survey.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessions: Object.fromEntries(
            survey.sessions.map((s) => [s.id, { rating: ratings[s.id], feedback: feedback[s.id] ?? "" }]),
          ),
          dayRating: ratings[DAY],
          dayChange: feedback[DAY] ?? "",
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (body?.sessionId) setMissing(new Set([body.sessionId]));
        setError(ERRORS[body?.error ?? ""] ?? `Could not save your answers (${res.status}).`);
        return;
      }
      setSubmittedAt(body.submittedAt);
      setJustSaved(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const rate = (id: string) => (value: number) => {
    setRatings((r) => ({ ...r, [id]: value }));
    setMissing((m) => {
      if (!m.has(id)) return m;
      const next = new Set(m);
      next.delete(id);
      return next;
    });
  };
  const write = (id: string) => (value: string) => setFeedback((f) => ({ ...f, [id]: value }));

  return (
    <motion.form
      variants={staggerParent(0.05)}
      initial="hidden"
      animate="show"
      onSubmit={submit}
      noValidate
      className="space-y-6"
    >
      <motion.div variants={riseChild} className="space-y-2">
        <h1 className="text-3xl font-medium tracking-tight">Day {survey.day} Survey</h1>
        <p className="text-sm text-muted-foreground">
          {SURVEY_STAGE_LABELS[survey.stage]} · {surveyDate(survey.date)}
          {submittedAt && <> · answered {new Date(submittedAt).toLocaleString()}</>}
        </p>
      </motion.div>

      <motion.div variants={staggerParent(0.04)} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        {survey.sessions.map((s) => (
          <motion.fieldset
            key={s.id}
            variants={riseChild}
            className={cn("space-y-4 px-5 py-4", missing.has(s.id) && "bg-destructive/5")}
          >
            <legend className="sr-only">{s.name}</legend>
            <div className="space-y-0.5">
              <p className="text-base font-medium">
                {s.emoji && <span className="mr-1.5">{s.emoji}</span>}
                {s.name}
              </p>
              <p className="text-xs text-muted-foreground">{formatClock(s.start)}</p>
            </div>
            <Rating
              name={`rating-${s.id}`}
              question={SURVEY_QUESTIONS.sessionRating}
              value={ratings[s.id]}
              missing={missing.has(s.id)}
              onChange={rate(s.id)}
            />
            <Feedback question={SURVEY_QUESTIONS.sessionFeedback} value={feedback[s.id] ?? ""} onChange={write(s.id)} />
          </motion.fieldset>
        ))}
        <motion.fieldset
          variants={riseChild}
          className={cn("space-y-4 px-5 py-4", missing.has(DAY) && "bg-destructive/5")}
        >
          <legend className="sr-only">The day overall</legend>
          <p className="text-base font-medium">The day overall</p>
          <Rating
            name="rating-day"
            question={SURVEY_QUESTIONS.dayRating}
            value={ratings[DAY]}
            missing={missing.has(DAY)}
            onChange={rate(DAY)}
          />
          <Feedback question={SURVEY_QUESTIONS.dayChange} value={feedback[DAY] ?? ""} onChange={write(DAY)} />
        </motion.fieldset>
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="brand" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : submittedAt ? <Save /> : <Send />}
          {submittedAt ? "Save changes" : "Submit"}
        </Button>
        {justSaved && (
          <span role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-brand" />
            Thanks, your answers are saved.
          </span>
        )}
      </motion.div>
    </motion.form>
  );
}

/** A required 1 to 5 rating, as a row of numbered choices from Poor to Excellent. */
export function Rating({
  name,
  question,
  value,
  missing,
  onChange,
  disabled = false,
}: {
  name: string;
  question: string;
  value: number | undefined;
  missing: boolean;
  onChange: (value: number) => void;
  /** Shown but not answerable, as in the scheduler's preview. */
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={question} aria-required className="space-y-2">
      <p className="text-sm" aria-hidden>
        {question}
        <span className="text-destructive"> *</span>
      </p>
      <div className="flex items-start gap-2">
        {RATINGS.map((r) => (
          <label key={r} className="relative flex w-14 flex-col items-center gap-1">
            <input
              type="radio"
              name={name}
              value={r}
              checked={value === r}
              disabled={disabled}
              onChange={() => onChange(r)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex size-10 cursor-pointer items-center justify-center rounded-full border bg-field text-sm font-medium transition-colors",
                "hover:border-brand-border peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
                "peer-checked:border-brand peer-checked:bg-brand peer-checked:text-brand-foreground",
              )}
            >
              {r}
            </span>
            <span className="text-center text-xs text-muted-foreground">{RATING_LABELS[r] ?? ""}</span>
          </label>
        ))}
      </div>
      {missing && <p className="text-xs text-destructive">Choose a rating.</p>}
    </div>
  );
}

export function Feedback({
  question,
  value,
  onChange,
  disabled = false,
}: {
  question: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <span className="block text-sm">{question}</span>
      <Textarea value={value} maxLength={SURVEY_LIMITS.answer} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

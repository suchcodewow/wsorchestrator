"use client";

/**
 * The intake form as someone in the current cohort fills it in, under their
 * own sign-in: each question, starting from the answers they last saved,
 * checked in the browser for what is required and again by the server when
 * it is saved. They can come back and change their answers at any time.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Eye, Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { INTAKE_LIMITS, type IntakeQuestion } from "@/db/schema";
import type { MyIntake } from "@/lib/logistics/intake";
import { HAS_OPTIONS, isFirstLast, isNameQuestion, type IntakeAnswers } from "@/lib/logistics/intake-values";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

const SELECT = cn(
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50",
);

/** What an "Other" answer is held under until it is sent. */
const OTHER = "\u0000other";

const ERRORS: Record<string, string> = {
  not_in_cohort: "This form is no longer yours to fill in: you are not in the current cohort.",
  no_questions: "This form no longer asks anything. Reload the page.",
  impersonating: "You are viewing the app as someone else, so their answers cannot be changed.",
  required: "Answer every question marked with *.",
  not_an_option: "One of your answers is not one the form offers. The form may have changed: reload the page.",
  not_a_name: "Give your name as a first and a last name, with one space between.",
};

/**
 * Saved answers as the inputs hold them: one a list question does not offer
 * is its "Other", which is how it was given.
 */
function startingFrom(intake: MyIntake): { answers: IntakeAnswers; others: Record<string, string> } {
  const answers: IntakeAnswers = {};
  const others: Record<string, string> = {};
  for (const q of intake.questions) {
    const saved = intake.answers[q.id];
    if (saved === undefined) continue;
    if (!HAS_OPTIONS.has(q.kind) || !q.other) {
      answers[q.id] = saved;
      continue;
    }
    const values = Array.isArray(saved) ? saved : [saved];
    const outside = values.find((v) => !q.options.includes(v));
    if (outside !== undefined) others[q.id] = outside;
    const held = values.map((v) => (v === outside ? OTHER : v));
    answers[q.id] = q.kind === "checkboxes" ? held : held[0]!;
  }
  // The name question starts from the name the app already has for them.
  const nameQuestion = intake.questions.find(isNameQuestion);
  if (nameQuestion && answers[nameQuestion.id] === undefined && intake.name) answers[nameQuestion.id] = intake.name;
  return { answers, others };
}

/** The name question's answer, when there is one and it is not a first and a last name. */
function badName(q: IntakeQuestion, value: string | string[] | undefined): boolean {
  return isNameQuestion(q) && typeof value === "string" && value.trim() !== "" && !isFirstLast(value);
}

export function IntakeFormFiller({ intake, preview }: { intake: MyIntake; preview: boolean }) {
  const [start] = useState(() => startingFrom(intake));
  const [answers, setAnswers] = useState<IntakeAnswers>(start.answers);
  const [others, setOthers] = useState<Record<string, string>>(start.others);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(intake.savedAt);
  const [justSaved, setJustSaved] = useState(false);

  /** The answers as the server takes them, with "Other" replaced by what was typed. */
  function payload(): IntakeAnswers {
    const out: IntakeAnswers = {};
    for (const q of intake.questions) {
      const a = answers[q.id];
      if (a === undefined) continue;
      const other = (others[q.id] ?? "").trim();
      out[q.id] = Array.isArray(a)
        ? a.map((v) => (v === OTHER ? other : v)).filter(Boolean)
        : a === OTHER
          ? other
          : a;
    }
    return out;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setJustSaved(false);
    const out = payload();
    const unanswered = intake.questions.filter((q) => {
      const a = out[q.id];
      return q.required && (a === undefined || (Array.isArray(a) ? a.length === 0 : a.trim() === ""));
    });
    setMissing(new Set(unanswered.map((q) => q.id)));
    if (unanswered.length > 0) {
      setError(ERRORS.required!);
      return;
    }
    const misnamed = intake.questions.find((q) => badName(q, out[q.id]));
    if (misnamed) {
      setMissing(new Set([misnamed.id]));
      setError(ERRORS.not_a_name!);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/intake?form=${intake.form}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: out }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (body?.questionId) setMissing(new Set([body.questionId]));
        setError(ERRORS[body?.error ?? ""] ?? `Could not save your answers (${res.status}).`);
        return;
      }
      setSavedAt(body.savedAt);
      setJustSaved(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

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
        <h1 className="text-3xl font-medium tracking-tight">{intake.heading}</h1>
        {intake.introduction && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{intake.introduction}</p>
        )}
        {savedAt && (
          <p className="text-sm text-muted-foreground">
            Answered {new Date(savedAt).toLocaleString()}. Change anything below and save again.
          </p>
        )}
      </motion.div>

      {preview && (
        <motion.p
          variants={riseChild}
          className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground"
        >
          <Eye className="size-4 shrink-0" />
          A preview of the form as the cohort sees it. Nothing you enter here is saved.
        </motion.p>
      )}

      <motion.div variants={staggerParent(0.04)} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        {intake.questions.map((q) => (
          <motion.fieldset
            key={q.id}
            variants={riseChild}
            className={cn("space-y-3 px-5 py-4", missing.has(q.id) && "bg-destructive/5")}
          >
            <legend className="sr-only">{q.title}</legend>
            <div className="space-y-1">
              <p className="text-sm font-medium" aria-hidden>
                {q.title}
                {q.required && <span className="text-destructive"> *</span>}
              </p>
              {q.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{q.description}</p>}
              {isNameQuestion(q) && (
                <p className="text-sm text-muted-foreground">
                  Your first and last name, like Sam Rivera. It is the name on your name card and everywhere else here.
                </p>
              )}
            </div>
            <Answer
              question={q}
              value={answers[q.id]}
              other={others[q.id] ?? ""}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
              onOther={(v) => setOthers((o) => ({ ...o, [q.id]: v }))}
            />
            {missing.has(q.id) && (
              <p className="text-xs text-destructive">
                {badName(q, answers[q.id])
                  ? "Enter a first name and a last name, with one space between."
                  : "This question needs an answer."}
              </p>
            )}
          </motion.fieldset>
        ))}
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="brand" disabled={busy || preview}>
          {busy ? <Loader2 className="animate-spin" /> : savedAt ? <Save /> : <Send />}
          {savedAt ? "Save changes" : "Submit"}
        </Button>
        {justSaved && (
          <span role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-brand" />
            Your answers are saved.
          </span>
        )}
      </motion.div>
    </motion.form>
  );
}

/** One question's input, by its kind. */
function Answer({
  question: q,
  value,
  other,
  onChange,
  onOther,
}: {
  question: IntakeQuestion;
  value: string | string[] | undefined;
  other: string;
  onChange: (value: string | string[]) => void;
  onOther: (value: string) => void;
}) {
  const name = `intake-${q.id}`;

  if (q.kind === "short") {
    return (
      <Input
        aria-label={q.title}
        value={(value as string) ?? ""}
        maxLength={INTAKE_LIMITS.answer}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (q.kind === "paragraph") {
    return (
      <Textarea
        aria-label={q.title}
        value={(value as string) ?? ""}
        maxLength={INTAKE_LIMITS.answer}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (q.kind === "dropdown") {
    return (
      <select aria-label={q.title} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className={SELECT}>
        <option value="">Choose</option>
        {q.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  const multiple = q.kind === "checkboxes";
  const chosen = new Set(multiple ? ((value as string[]) ?? []) : value ? [value as string] : []);
  const toggle = (option: string, on: boolean) => {
    if (!multiple) return onChange(option);
    const next = new Set(chosen);
    if (on) next.add(option);
    else next.delete(option);
    onChange([...next]);
  };
  const choices = [...q.options.map((o) => ({ value: o, label: o })), ...(q.other ? [{ value: OTHER, label: "Other:" }] : [])];

  return (
    <div className="space-y-2">
      {choices.map((c) => (
        <label key={c.value} className="flex items-center gap-2 text-sm">
          <input
            type={multiple ? "checkbox" : "radio"}
            name={name}
            checked={chosen.has(c.value)}
            onChange={(e) => toggle(c.value, e.target.checked)}
            className="size-3.5 shrink-0 accent-brand"
          />
          {c.label}
          {c.value === OTHER && (
            <Input
              aria-label={`${q.title}: other`}
              value={other}
              maxLength={INTAKE_LIMITS.answer}
              className="h-8"
              onFocus={() => !chosen.has(OTHER) && toggle(OTHER, true)}
              onChange={(e) => onOther(e.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );
}

"use client";

/**
 * The intake form as an attendee fills it in: their email, then each
 * question, checked in the browser for what is required and again by the
 * server when it is sent.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { INTAKE_LIMITS, type IntakeQuestion } from "@/db/schema";
import type { IntakeAnswers, IntakeForm } from "@/lib/logistics/intake-values";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

const SELECT = cn(
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50",
);

/** What an "Other" answer is held under until it is sent. */
const OTHER = "\u0000other";

export function IntakeFormFiller({ form }: { form: IntakeForm }) {
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<IntakeAnswers>({});
  const [others, setOthers] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /** The answers as the server takes them, with "Other" replaced by what was typed. */
  function payload(): IntakeAnswers {
    const out: IntakeAnswers = {};
    for (const q of form.questions) {
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
    const out = payload();
    const unanswered = form.questions.filter((q) => {
      const a = out[q.id];
      return q.required && (a === undefined || (Array.isArray(a) ? a.length === 0 : a.trim() === ""));
    });
    setMissing(new Set(unanswered.map((q) => q.id)));
    if (unanswered.length > 0) {
      setError("Answer every question marked with *.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, answers: out }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (body?.questionId) setMissing(new Set([body.questionId]));
        setError(
          body?.error === "invalid"
            ? "Check your email address."
            : "One of your answers is not one the form offers. The form may have changed: reload the page.",
        );
        return;
      }
      setSent(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <motion.div
        variants={riseChild}
        initial="hidden"
        animate="show"
        className="space-y-2 rounded-2xl border bg-card px-5 py-8 text-center shadow-sm"
      >
        <CheckCircle2 className="mx-auto size-8 text-brand" />
        <h1 className="text-xl font-medium tracking-tight">Thanks, {email}</h1>
        <p className="text-sm text-muted-foreground">Your answers to {form.title} were sent.</p>
      </motion.div>
    );
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
        <h1 className="text-3xl font-medium tracking-tight">{form.title}</h1>
        {form.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{form.description}</p>}
      </motion.div>

      <motion.div variants={staggerParent(0.04)} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <motion.div variants={riseChild} className="space-y-2 px-5 py-4">
          <label htmlFor="intake-email" className="text-sm font-medium">
            Email <span className="text-destructive">*</span>
          </label>
          <Input
            id="intake-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            maxLength={320}
            onChange={(e) => setEmail(e.target.value)}
          />
        </motion.div>

        {form.questions.map((q) => (
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
            </div>
            <Answer
              question={q}
              value={answers[q.id]}
              other={others[q.id] ?? ""}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
              onOther={(v) => setOthers((o) => ({ ...o, [q.id]: v }))}
            />
            {missing.has(q.id) && <p className="text-xs text-destructive">This question needs an answer.</p>}
          </motion.fieldset>
        ))}
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild}>
        <Button type="submit" variant="brand" disabled={busy || email.trim() === ""}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
          Submit
        </Button>
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

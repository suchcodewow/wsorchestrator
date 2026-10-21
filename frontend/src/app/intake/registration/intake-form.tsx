"use client";

/**
 * The intake form as someone in the current cohort fills it in, under their
 * own sign-in: each question, starting from the answers they last saved,
 * checked in the browser for what is required and again by the server when
 * it is saved. They can come back and change their answers at any time.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Eye, Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { INTAKE_LIMITS, type IntakeQuestion } from "@/db/schema";
import type { MyIntake } from "@/lib/logistics/intake";
import { timeZoneChoices } from "@/lib/timezones";
import {
  HAS_OPTIONS,
  isFirstName,
  isNameQuestion,
  isTimezoneQuestion,
  splitBold,
  type IntakeAnswers,
} from "@/lib/logistics/intake-values";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

const SELECT = cn(
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50",
);

/** What an "Other" answer is held under until it is sent. */
const OTHER = "\u0000other";

const ERRORS: Record<string, string> = {
  not_in_cohort:
    "This form is no longer yours to fill in: you are not in the current cohort.",
  no_questions: "This form no longer asks anything. Reload the page.",
  impersonating:
    "You are viewing the app as someone else, so their answers cannot be changed.",
  required: "Answer every question marked with *.",
  not_an_option:
    "One of your answers is not one the form offers. The form may have changed: reload the page.",
  not_a_name: "Give a first name only: letters, with no spaces.",
};

/** Said once they have deferred, and to anyone already deferred who opens the page. */
const DEFERRED_BODY = "Be on the lookout for a message about the next session.";

/** `text` with whatever is wrapped in `**` shown in bold; the form's dates line is. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((part, i) =>
        part.bold ? (
          <strong key={i} className="font-semibold">
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Saved answers as the inputs hold them: one a list question does not offer
 * is its "Other", which is how it was given.
 */
function startingFrom(intake: MyIntake): {
  answers: IntakeAnswers;
  others: Record<string, string>;
} {
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
  if (nameQuestion && answers[nameQuestion.id] === undefined && intake.name)
    answers[nameQuestion.id] = intake.name;
  // The time zone question starts from the zone the app already has for them.
  const zoneQuestion = intake.questions.find(isTimezoneQuestion);
  if (zoneQuestion && answers[zoneQuestion.id] === undefined && intake.timezone)
    answers[zoneQuestion.id] = intake.timezone;
  return { answers, others };
}

/** The name question's answer, when there is one and it is not a single first name. */
function badName(
  q: IntakeQuestion,
  value: string | string[] | undefined,
): boolean {
  return (
    isNameQuestion(q) &&
    typeof value === "string" &&
    value.trim() !== "" &&
    !isFirstName(value)
  );
}

export function IntakeFormFiller({
  intake,
  preview,
}: {
  intake: MyIntake;
  preview: boolean;
}) {
  const [start] = useState(() => startingFrom(intake));
  const [answers, setAnswers] = useState<IntakeAnswers>(start.answers);
  const [others, setOthers] = useState<Record<string, string>>(start.others);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(intake.savedAt);
  const [justSaved, setJustSaved] = useState(false);
  // Someone who has not answered yet chooses first: sign up, which shows the
  // questions, or defer. Someone who already answered has signed up.
  const stage = intake.form === "intermediate" ? "Intermediate" : "Bootcamp";
  const [phase, setPhase] = useState<"choose" | "form" | "deferred">(
    intake.canDefer && !intake.savedAt ? "choose" : "form",
  );
  const [confirming, setConfirming] = useState(false);
  const [deferring, setDeferring] = useState(false);
  const [deferError, setDeferError] = useState<string | null>(null);

  async function defer() {
    setDeferError(null);
    if (preview) {
      setConfirming(false);
      setPhase("deferred");
      return;
    }
    setDeferring(true);
    try {
      const res = await fetch(`/api/intake/defer?form=${intake.form}`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setDeferError(
          ERRORS[body?.error ?? ""] ?? `Could not defer you (${res.status}).`,
        );
        return;
      }
      setConfirming(false);
      setPhase("deferred");
    } catch {
      setDeferError("Could not reach the server.");
    } finally {
      setDeferring(false);
    }
  }

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
      return (
        q.required &&
        (a === undefined ||
          (Array.isArray(a) ? a.length === 0 : a.trim() === ""))
      );
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
        setError(
          ERRORS[body?.error ?? ""] ??
            `Could not save your answers (${res.status}).`,
        );
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
      <motion.div variants={riseChild}>
        <h1 className="text-3xl font-medium tracking-tight">
          {intake.heading}
        </h1>
      </motion.div>

      {preview && (
        <motion.p
          variants={riseChild}
          className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground"
        >
          <Eye className="size-4 shrink-0" />A preview of the form as the cohort
          sees it. Nothing you enter here is saved.
        </motion.p>
      )}

      <Dialog
        open={confirming}
        onOpenChange={(open) => !deferring && setConfirming(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Defer to the next {stage}?</DialogTitle>
            <DialogDescription>
              You will not attend this {stage}. You will be moved to the next
              one, and the training team will message you about it.
            </DialogDescription>
          </DialogHeader>
          {deferError && (
            <p role="alert" className="text-sm text-destructive">
              {deferError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deferring}
              onClick={() => setConfirming(false)}
            >
              No, keep my place
            </Button>
            <Button
              type="button"
              variant="brand"
              disabled={deferring}
              onClick={defer}
            >
              {deferring && <Loader2 className="animate-spin" />}
              Yes, defer me
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <motion.div
        variants={riseChild}
        className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        {(intake.introduction ||
          savedAt ||
          (!savedAt && intake.carriedFrom)) && (
          <div className="space-y-3 px-5 py-4 text-sm leading-relaxed">
            {intake.introduction && (
              <p className="whitespace-pre-line">
                <Rich text={intake.introduction} />
              </p>
            )}
            {savedAt && (
              <p className="text-muted-foreground">
                Answered {new Date(savedAt).toLocaleString()}. Change anything
                below and save again.
              </p>
            )}
            {!savedAt && intake.carriedFrom && (
              <p className="rounded-lg border border-brand-border bg-brand-subtle px-4 py-3">
                We&apos;ve filled in your dietary needs from your Bootcamp
                registration on{" "}
                {new Date(intake.carriedFrom.savedAt).toLocaleDateString()}.
                Update anything that&apos;s changed, then submit.
              </p>
            )}
          </div>
        )}

        {phase === "choose" && (
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <Button
              type="button"
              variant="brand"
              onClick={() => setPhase("form")}
            >
              Sign-Up for {stage}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(true)}
            >
              Defer
            </Button>
          </div>
        )}

        {phase === "deferred" && (
          <div role="status" className="space-y-1 px-5 py-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-4 text-brand" />
              You are deferred to the next {stage}
            </p>
            <p className="text-sm text-muted-foreground">{DEFERRED_BODY}</p>
          </div>
        )}

        {phase === "form" &&
          intake.questions.map((q) => (
            <fieldset
              key={q.id}
              className={cn(
                "space-y-3 px-5 py-4",
                missing.has(q.id) && "bg-destructive/5",
              )}
            >
              <legend className="sr-only">{q.title}</legend>
              <div className="space-y-1">
                <p className="text-sm font-medium" aria-hidden>
                  {q.title}
                  {q.required && <span className="text-destructive"> *</span>}
                </p>
                {q.description && (
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {q.description}
                  </p>
                )}
                {isNameQuestion(q) && (
                  <p className="text-sm text-muted-foreground">
                    Optional. Give only a first name, with no spaces, like Sam.
                    It is saved as your preferred name and used on your name
                    card and everywhere else here; your official name is not
                    changed.
                  </p>
                )}
                {isTimezoneQuestion(q) && (
                  <p className="text-sm text-muted-foreground">
                    It is used to schedule your sessions, and starts from the
                    time zone your Slack profile has. Change it if it is wrong.
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
                    ? "Enter a first name only: letters, with no spaces."
                    : "This question needs an answer."}
                </p>
              )}
            </fieldset>
          ))}
      </motion.div>

      {phase === "form" && error && (
        <motion.p
          variants={riseChild}
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </motion.p>
      )}

      {phase === "form" && (
        <motion.div
          variants={riseChild}
          className="flex flex-wrap items-center gap-3"
        >
          <Button type="submit" variant="brand" disabled={busy || preview}>
            {busy ? (
              <Loader2 className="animate-spin" />
            ) : savedAt ? (
              <Save />
            ) : (
              <Send />
            )}
            {savedAt ? "Save changes" : "Submit"}
          </Button>
          {justSaved && (
            <span
              role="status"
              className="flex items-center gap-1.5 text-sm text-muted-foreground"
            >
              <CheckCircle2 className="size-4 text-brand" />
              Your answers are saved.
            </span>
          )}
        </motion.div>
      )}
    </motion.form>
  );
}

/**
 * The time zone picker: one zone per UTC offset, in order of the offset. The
 * list is fixed from the zone the form opened with, so choosing one does not
 * reshuffle it; a zone the person already has stands for its own offset.
 */
function TimeZoneSelect({
  title,
  value,
  onChange,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [opened] = useState(value);
  const choices = useMemo(() => timeZoneChoices(new Date(), opened), [opened]);
  // A zone picked from this list is already in it; the opened one may be since replaced by another on its offset.
  const shown = choices.some((c) => c.value === value)
    ? value
    : (choices.find((c) => c.value === opened)?.value ?? "");
  return (
    <select
      aria-label={title}
      value={shown}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT}
    >
      <option value="">Choose</option>
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
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
        // A first name has no spaces, so none can be typed or pasted into it.
        onChange={(e) =>
          onChange(
            isNameQuestion(q)
              ? e.target.value.replace(/\s/g, "")
              : e.target.value,
          )
        }
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

  if (isTimezoneQuestion(q)) {
    return (
      <TimeZoneSelect
        title={q.title}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
      />
    );
  }

  if (q.kind === "dropdown") {
    return (
      <select
        aria-label={q.title}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT}
      >
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
  const chosen = new Set(
    multiple ? ((value as string[]) ?? []) : value ? [value as string] : [],
  );
  const toggle = (option: string, on: boolean) => {
    if (!multiple) return onChange(option);
    const next = new Set(chosen);
    if (on) next.add(option);
    else next.delete(option);
    onChange([...next]);
  };
  const choices = [
    ...q.options.map((o) => ({ value: o, label: o })),
    ...(q.other ? [{ value: OTHER, label: "Other:" }] : []),
  ];

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

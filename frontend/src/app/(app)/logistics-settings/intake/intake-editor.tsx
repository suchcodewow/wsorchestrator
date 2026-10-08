"use client";

/**
 * Edits the intake form attendees fill in at /intake: its title and
 * description, and its questions in order, each with a kind, whether it is
 * required, and for a list its options. Saving replaces the whole form.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { INTAKE_LIMITS, INTAKE_QUESTION_KINDS, type IntakeQuestion, type IntakeQuestionKind } from "@/db/schema";
import { HAS_OPTIONS, HAS_OTHER, KIND_LABELS } from "@/lib/logistics/intake-values";
import type { IntakeFormView } from "@/lib/logistics/intake";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

const SELECT = cn(
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
);

const ERRORS: Record<string, string> = {
  invalid: "Give the form a title, every question a title, and every list question at least one option, with none repeated.",
  forbidden: "Your own role changed — reload the page.",
};

const newId = () => `q-${crypto.randomUUID().slice(0, 8)}`;

const blank = (): IntakeQuestion => ({
  id: newId(),
  kind: "short",
  title: "",
  description: "",
  required: false,
  options: [],
  other: false,
});

export function IntakeEditor({ form }: { form: IntakeFormView }) {
  const router = useRouter();
  const [title, setTitle] = useState(form.title);
  const [description, setDescription] = useState(form.description);
  const [questions, setQuestions] = useState<IntakeQuestion[]>(form.questions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(form.updatedAt);

  const listsComplete = questions.every(
    (q) => !HAS_OPTIONS.has(q.kind) || (q.options.length > 0 && q.options.every((o) => o.trim().length > 0)),
  );
  const canSave =
    title.trim().length > 0 &&
    questions.length > 0 &&
    questions.every((q) => q.title.trim().length > 0) &&
    listsComplete;

  function change(id: string, patch: Partial<IntakeQuestion>) {
    setQuestions((list) => list.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function setKind(q: IntakeQuestion, kind: IntakeQuestionKind) {
    const options = HAS_OPTIONS.has(kind) && q.options.length === 0 ? ["Option 1"] : q.options;
    change(q.id, { kind, options, other: HAS_OTHER.has(kind) && q.other });
  }

  function move(index: number, by: -1 | 1) {
    setQuestions((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  }

  function duplicate(index: number) {
    setQuestions((list) => {
      const next = [...list];
      next.splice(index + 1, 0, { ...list[index]!, id: newId(), options: [...list[index]!.options] });
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/logistics/intake-form", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, questions }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`);
        return;
      }
      setSavedAt(body.updatedAt);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-3xl space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">Intake form</h2>
          <p className="text-sm text-muted-foreground">
            {savedAt ? (
              <>
                {questions.length} {questions.length === 1 ? "question" : "questions"}, last saved{" "}
                <span className="font-medium text-foreground">{new Date(savedAt).toLocaleString()}</span>
              </>
            ) : (
              <>{questions.length} questions, not saved yet: attendees see the default form</>
            )}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/intake" target="_blank">
            <ExternalLink />
            Open the form
          </Link>
        </Button>
      </motion.div>

      <motion.div variants={staggerParent(0.04)} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <motion.section variants={riseChild} className="space-y-4 px-5 py-4">
          <div className="space-y-1.5">
            <label htmlFor="intake-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="intake-title"
              value={title}
              maxLength={INTAKE_LIMITS.title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="intake-description" className="text-sm font-medium">
              Description
            </label>
            <Textarea
              id="intake-description"
              placeholder="Shown under the title"
              value={description}
              maxLength={INTAKE_LIMITS.description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">Every attendee is also asked for their email, first.</p>
        </motion.section>

        {questions.map((q, i) => (
          <motion.section key={q.id} variants={riseChild} className="space-y-3 px-5 py-4">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-6 shrink-0 text-sm text-muted-foreground">{i + 1}.</span>
              <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_11rem]">
                <Textarea
                  aria-label={`Question ${i + 1}`}
                  placeholder="Question"
                  rows={1}
                  value={q.title}
                  maxLength={INTAKE_LIMITS.title}
                  className="min-h-9"
                  onChange={(e) => change(q.id, { title: e.target.value })}
                />
                <select
                  aria-label={`Question ${i + 1} kind`}
                  value={q.kind}
                  onChange={(e) => setKind(q, e.target.value as IntakeQuestionKind)}
                  className={SELECT}
                >
                  {INTAKE_QUESTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-3 pl-8">
              <Textarea
                aria-label={`Question ${i + 1} description`}
                placeholder="Description (optional)"
                value={q.description}
                maxLength={INTAKE_LIMITS.description}
                onChange={(e) => change(q.id, { description: e.target.value })}
              />

              {HAS_OPTIONS.has(q.kind) ? (
                <OptionsEditor question={q} index={i} onChange={(patch) => change(q.id, patch)} />
              ) : (
                <p className="border-b border-dashed pb-1 text-sm text-muted-foreground">
                  {q.kind === "short" ? "Short answer text" : "Long answer text"}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) => change(q.id, { required: e.target.checked })}
                    className="size-3.5 shrink-0 accent-brand"
                  />
                  Required
                </label>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move question ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move question ${i + 1} down`}
                    disabled={i === questions.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Duplicate question ${i + 1}`}
                    disabled={questions.length >= INTAKE_LIMITS.questions}
                    onClick={() => duplicate(i)}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove question ${i + 1}`}
                    disabled={questions.length === 1}
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setQuestions((list) => list.filter((x) => x.id !== q.id))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </motion.section>
        ))}

        <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3 px-5 py-4">
          <Button
            variant="outline"
            disabled={questions.length >= INTAKE_LIMITS.questions}
            onClick={() => setQuestions((list) => [...list, blank()])}
          >
            <Plus />
            Add question
          </Button>
          <span className="text-sm text-muted-foreground">
            {questions.filter((q) => q.required).length} of {questions.length} required
          </span>
        </motion.div>
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild}>
        <Button variant="brand" disabled={!canSave || busy} onClick={save}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
      </motion.div>
    </motion.div>
  );
}

/** A list question's options, each removable, and the "Other" a choice or checkboxes question may add. */
function OptionsEditor({
  question: q,
  index,
  onChange,
}: {
  question: IntakeQuestion;
  index: number;
  onChange: (patch: Partial<IntakeQuestion>) => void;
}) {
  const marker = (n: number) =>
    q.kind === "dropdown" ? (
      <span className="w-4 shrink-0 text-right text-sm text-muted-foreground">{n}.</span>
    ) : (
      <span className={cn("size-4 shrink-0 border border-muted-foreground/50", q.kind === "choice" ? "rounded-full" : "rounded-sm")} />
    );

  function setOption(n: number, value: string) {
    onChange({ options: q.options.map((o, j) => (j === n ? value : o)) });
  }

  return (
    <div className="space-y-2">
      {q.options.map((option, n) => (
        <div key={n} className="flex items-center gap-2">
          {marker(n + 1)}
          <Input
            aria-label={`Question ${index + 1} option ${n + 1}`}
            value={option}
            maxLength={INTAKE_LIMITS.option}
            onChange={(e) => setOption(n, e.target.value)}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove option ${n + 1}`}
            disabled={q.options.length === 1}
            onClick={() => onChange({ options: q.options.filter((_, j) => j !== n) })}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      {q.other && (
        <div className="flex items-center gap-2">
          {marker(q.options.length + 1)}
          <span className="flex-1 border-b border-dashed pb-1 text-sm text-muted-foreground">Other: their own answer</span>
          <Button variant="ghost" size="icon" aria-label="Remove Other" onClick={() => onChange({ other: false })}>
            <X className="size-3.5" />
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <Button
          variant="ghost"
          size="sm"
          disabled={q.options.length >= INTAKE_LIMITS.options}
          onClick={() => onChange({ options: [...q.options, `Option ${q.options.length + 1}`] })}
        >
          <Plus />
          Add option
        </Button>
        {HAS_OTHER.has(q.kind) && !q.other && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ other: true })}>
            Add &ldquo;Other&rdquo;
          </Button>
        )}
      </div>
    </div>
  );
}

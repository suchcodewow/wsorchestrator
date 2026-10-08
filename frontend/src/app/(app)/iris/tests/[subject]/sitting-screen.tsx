"use client";

/**
 * One sitting, a question at a time. The server holds the run and grades each
 * answer, so this only ever has the question on screen: no key, no level.
 * There is no going back, and leaving resumes the same question.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SittingView } from "@/lib/iris/attempts";
import type { Confidence, Level } from "@/lib/iris/engine";
import { LEVEL_LABELS, TRAINING, type SubjectKey } from "@/lib/iris/subjects";
import { FADE, riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { LevelBadge } from "../../level-badge";

const IDK = -1;
const LETTERS = ["A", "B", "C", "D"];

const START_ERRORS: Record<string, string> = {
  already_taken: "You have already taken this subject. Each one is taken once.",
  not_ready: "This subject is not open yet.",
  no_track: "Choose your role on the Iris page first.",
};

type State =
  | { kind: "loading" }
  | { kind: "asking"; sitting: SittingView }
  | { kind: "done"; questions: number; placement?: Level; confidence?: Confidence }
  | { kind: "error"; message: string };

export function SittingScreen({
  subject,
  name,
  mode,
  selfId,
}: {
  subject: SubjectKey;
  name: string;
  mode: "live" | "preview";
  /** Set for an Assessments Administrator, whose finish screen shows the level and links to the full path. */
  selfId: string | null;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/iris/sittings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, mode }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setState({ kind: "error", message: START_ERRORS[body?.error] ?? `Could not start (${res.status})` });
          return;
        }
        setState({ kind: "asking", sitting: body.sitting });
      } catch {
        setState({ kind: "error", message: "Could not reach the server. Reload to try again." });
      }
    })();
  }, [subject, mode]);

  const send = useCallback(async () => {
    if (state.kind !== "asking" || selected === null || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/iris/sittings/${state.sitting.attemptId}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: state.sitting.number, choice: selected }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409 && body?.error === "stale" && body.sitting) {
        // Answered in another tab: carry on from where that left it.
        setState({ kind: "asking", sitting: body.sitting });
      } else if (!res.ok) {
        throw new Error(body?.error === "finished" ? "This sitting is already over." : `Could not save (${res.status})`);
      } else if (body.done) {
        setState({ kind: "done", questions: body.questions, placement: body.placement, confidence: body.confidence });
      } else {
        setState({ kind: "asking", sitting: body.sitting });
      }
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSending(false);
    }
  }, [state, selected, sending]);

  useEffect(() => {
    if (state.kind !== "asking") return;
    const options = state.sitting.question.options.length;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toUpperCase();
      const letter = LETTERS.indexOf(key);
      if (letter >= 0 && letter < options) setSelected(letter);
      else if (key === "E" || key === "5") setSelected(IDK);
      else if (/^[1-4]$/.test(key) && Number(key) <= options) setSelected(Number(key) - 1);
      else if (e.key === "Enter") void send();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, send]);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="mx-auto max-w-3xl space-y-6">
      <motion.div variants={riseChild} className="flex items-center justify-between gap-4">
        <Link href="/iris/tests" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          All subjects
        </Link>
        {mode === "preview" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <Eye className="size-3.5" />
            Preview: drafts included, nothing recorded
          </span>
        )}
      </motion.div>

      {state.kind === "loading" && (
        <motion.div variants={riseChild} className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading {name}…
        </motion.div>
      )}

      {state.kind === "error" && (
        <motion.div variants={riseChild} className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
          <p className="font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <Button asChild variant="outline" size="sm">
            <Link href="/iris/tests">Back to the subjects</Link>
          </Button>
        </motion.div>
      )}

      {state.kind === "done" && (
        <motion.div variants={riseChild} className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-6 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-xl font-medium tracking-tight">{mode === "preview" ? "Preview finished" : "Recorded"}</h2>
          </div>
          <p className="text-sm text-muted-foreground tnum">
            {name} · {state.questions} questions answered
          </p>
          {state.placement && (
            <div className="divide-y overflow-hidden rounded-lg border text-sm">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="text-xs font-medium text-muted-foreground">Placement</span>
                <LevelBadge level={state.placement} />
                {state.confidence && <span className="text-muted-foreground">{state.confidence} confidence</span>}
              </div>
              <div className="px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Routes to · {LEVEL_LABELS[state.placement]} tier
                </p>
                <p className="mt-1">{TRAINING[subject][state.placement]}</p>
              </div>
              <p className="px-4 py-3 text-xs text-muted-foreground">
                {mode === "preview"
                  ? "A preview, so this is not recorded anywhere."
                  : "Shown because you are an Assessments Administrator. A taker sees only that their answers are recorded."}
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="brand">
              <Link href="/iris/tests">
                Back to the subjects
                <ArrowRight />
              </Link>
            </Button>
            {selfId && mode === "live" && (
              <Button asChild variant="outline">
                <Link href={`/iris/cohort/${encodeURIComponent(selfId)}`}>See the full path</Link>
              </Button>
            )}
          </div>
        </motion.div>
      )}

      {state.kind === "asking" && (
        <motion.div variants={riseChild} className="space-y-6">
          <div className="space-y-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <motion.div
                className="h-full rounded-full bg-brand"
                initial={false}
                animate={{ width: `${state.sitting.progress}%` }}
                transition={FADE}
              />
            </div>
            <div className="flex justify-between text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <span>{name}</span>
              <span className="tnum">Question {state.sitting.number}</span>
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={`${state.sitting.attemptId}-${state.sitting.number}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={FADE}
              className="space-y-5"
            >
              <h2 className="text-xl leading-snug font-medium tracking-tight">{state.sitting.question.stem}</h2>

              <div className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm" role="radiogroup">
                {state.sitting.question.options.map((option, i) => (
                  <Option key={i} letter={LETTERS[i]!} selected={selected === i} onSelect={() => setSelected(i)}>
                    {option}
                  </Option>
                ))}
                <Option letter="E" selected={selected === IDK} onSelect={() => setSelected(IDK)} muted>
                  I don&apos;t know
                </Option>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Pick the single best answer. You can&apos;t go back.</p>
            <Button variant="brand" onClick={() => void send()} disabled={selected === null || sending}>
              {sending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
              Continue
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

function Option({
  letter,
  selected,
  onSelect,
  muted,
  children,
}: {
  letter: string;
  selected: boolean;
  onSelect: () => void;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-start gap-3 px-5 py-4 text-left transition-colors outline-none focus-visible:bg-accent",
        selected ? "bg-brand-subtle" : "hover:bg-muted/40",
      )}
    >
      <kbd
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md border font-mono text-xs",
          selected ? "border-brand bg-brand text-brand-foreground" : "bg-background text-muted-foreground",
        )}
      >
        {letter}
      </kbd>
      <span className={cn("pt-0.5", muted && !selected && "text-muted-foreground")}>{children}</span>
    </button>
  );
}

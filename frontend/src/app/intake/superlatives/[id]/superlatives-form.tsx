"use client";

/**
 * A Bootcamp superlatives survey as someone in the class fills it in: one
 * classmate, picked from the class, for each superlative. Every superlative
 * needs a vote, checked here and again by the server. They can come back and
 * change their votes at any time.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Save, Send, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { riseChild, staggerParent } from "@/lib/motion";
import { SUPERLATIVES_TITLE } from "@/lib/surveys/superlative-values";
import type { MySuperlatives } from "@/lib/surveys/superlatives";
import { surveyMonth } from "@/lib/surveys/survey-values";
import { cn } from "@/lib/utils";

const SELECT = cn(
  "h-10 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50",
);

const ERRORS: Record<string, string> = {
  impersonating: "You are viewing the app as someone else, so their votes cannot be changed.",
  required: "Choose a classmate for every superlative.",
  self_vote: "You can't vote for yourself. Choose a classmate.",
  not_a_nominee: "That person is no longer in the class. Choose someone else.",
  unknown_superlative: "This survey has changed since you opened it. Reload the page.",
  not_found: "This survey is no longer yours to fill in.",
};

export function SuperlativesFiller({ survey }: { survey: MySuperlatives }) {
  const [votes, setVotes] = useState<Record<string, string>>(survey.votes ?? {});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState(survey.submittedAt);
  const [justSaved, setJustSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setJustSaved(false);
    const unvoted = survey.superlatives.map((x) => x.id).filter((id) => !votes[id]);
    setMissing(new Set(unvoted));
    if (unvoted.length > 0) {
      setError(ERRORS.required!);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/superlatives/${survey.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ votes: Object.fromEntries(survey.superlatives.map((x) => [x.id, votes[x.id]])) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (body?.superlativeId) setMissing(new Set([body.superlativeId]));
        setError(ERRORS[body?.error ?? ""] ?? `Could not save your votes (${res.status}).`);
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

  function vote(id: string, email: string) {
    setVotes((v) => ({ ...v, [id]: email }));
    setMissing((m) => {
      if (!m.has(id)) return m;
      const next = new Set(m);
      next.delete(id);
      return next;
    });
  }

  return (
    <motion.form variants={staggerParent(0.05)} initial="hidden" animate="show" onSubmit={submit} noValidate className="space-y-6">
      <motion.div variants={riseChild} className="space-y-2">
        <h1 className="text-3xl font-medium tracking-tight">{SUPERLATIVES_TITLE}</h1>
        <p className="text-sm text-muted-foreground">
          {surveyMonth(survey.startDate)} Bootcamp · {survey.superlatives.length}{" "}
          {survey.superlatives.length === 1 ? "superlative" : "superlatives"}
          {submittedAt && <> · answered {new Date(submittedAt).toLocaleString()}</>}
        </p>
        <p className="text-sm text-muted-foreground">Vote for one classmate for each. Anyone in the class can be chosen, but not you.</p>
      </motion.div>

      <motion.div variants={staggerParent(0.04)} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        {survey.superlatives.map((x) => (
          <motion.label
            key={x.id}
            variants={riseChild}
            className={cn("block space-y-2 px-5 py-4", missing.has(x.id) && "bg-destructive/5")}
          >
            <span className="flex items-start gap-2 text-base font-medium">
              <Trophy className="mt-1 size-4 shrink-0 text-brand" />
              <span>
                {x.title}
                <span className="text-destructive"> *</span>
              </span>
            </span>
            <select
              value={votes[x.id] ?? ""}
              required
              aria-invalid={missing.has(x.id)}
              onChange={(e) => vote(x.id, e.target.value)}
              className={SELECT}
            >
              <option value="" disabled>
                Choose a classmate
              </option>
              {survey.ballot.map((n) => (
                <option key={n.email} value={n.email}>
                  {n.fullName || n.email}
                </option>
              ))}
            </select>
            {missing.has(x.id) && <span className="block text-xs text-destructive">Choose a classmate.</span>}
          </motion.label>
        ))}
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
            Thanks, your votes are saved.
          </span>
        )}
      </motion.div>
    </motion.form>
  );
}

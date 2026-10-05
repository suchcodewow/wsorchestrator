"use client";

/**
 * Creates or edits one assessment: its name, the session and group it scores,
 * whether it is offered, and its criteria in order. Once anyone has been
 * scored on it the session and group are fixed, and a criterion that has been
 * scored is retired rather than deleted when it is removed.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EVALS_ASSESSMENT_AUDIENCES,
  EVALS_ASSESSMENT_LIMITS,
  EVALS_ASSESSMENT_STAGES,
  type EvalsAssessmentAudience,
  type EvalsAssessmentStage,
} from "@/db/schema";
import { AUDIENCE_LABELS, STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { AssessmentDetail } from "@/lib/evals/assessments";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Detail = Omit<AssessmentDetail, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

/** A criterion being edited; `key` keeps React's rows straight while new ones have no id. */
type Draft = { key: string; id?: string; name: string; description: string; scored: boolean };

const LIST = "/evals-settings/assessments";

const SELECT = cn(
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
);

const ERRORS: Record<string, string> = {
  invalid: "Give the assessment a name and every criterion a name.",
  not_found: "That assessment was removed — go back to the list.",
  locked: "Someone has been scored on this assessment, so its session and group can no longer change.",
  has_scores: "Someone has been scored or recorded on this assessment, so it is kept. Make it inactive instead.",
  forbidden: "Your own role changed — reload the page.",
};

let nextKey = 0;
const newKey = () => `new-${nextKey++}`;

export function AssessmentEditor({ assessment }: { assessment: Detail | null }) {
  const router = useRouter();
  const locked = (assessment?.submissions ?? 0) > 0;
  const [name, setName] = useState(assessment?.name ?? "");
  const [stage, setStage] = useState<EvalsAssessmentStage>(assessment?.stage ?? "bootcamp");
  const [audience, setAudience] = useState<EvalsAssessmentAudience>(assessment?.audience ?? "both");
  const [active, setActive] = useState(assessment?.active ?? true);
  const [criteria, setCriteria] = useState<Draft[]>(
    assessment?.criteria.map((c) => ({ key: c.id, ...c })) ?? [
      { key: newKey(), name: "", description: "", scored: false },
    ],
  );
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSave =
    name.trim().length > 0 &&
    criteria.length > 0 &&
    criteria.length <= EVALS_ASSESSMENT_LIMITS.criteria &&
    criteria.every((c) => c.name.trim().length > 0);

  function change(key: string, patch: Partial<Draft>) {
    setCriteria((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function move(index: number, by: -1 | 1) {
    setCriteria((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  }

  async function request(kind: "save" | "delete", url: string, init: RequestInit) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`);
        return null;
      }
      return body ?? {};
    } catch {
      setError("Could not reach the server.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const payload = {
      name,
      stage,
      audience,
      active,
      criteria: criteria.map(({ id, name, description }) => ({ id, name, description })),
    };
    const body = assessment
      ? await request("save", `/api/evals/assessments/${assessment.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        })
      : await request("save", "/api/evals/assessments", { method: "POST", body: JSON.stringify(payload) });
    if (!body) return;
    router.push(LIST);
    router.refresh();
  }

  async function remove() {
    if (!assessment || !window.confirm(`Remove the assessment “${assessment.name}”?`)) return;
    const body = await request("delete", `/api/evals/assessments/${assessment.id}`, { method: "DELETE" });
    if (!body) return;
    router.push(LIST);
    router.refresh();
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-3xl space-y-6">
      <motion.div variants={riseChild} className="space-y-4">
        <Link
          href={LIST}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Assessments
        </Link>
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">{assessment ? assessment.name : "New assessment"}</h2>
          {assessment && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {assessment.submissions.toLocaleString()} {assessment.submissions === 1 ? "attendee" : "attendees"}
              </span>{" "}
              scored on it
              {locked && ", so its session and group are fixed"}.
            </p>
          )}
        </div>
      </motion.div>

      <motion.div
        variants={staggerParent(0.04)}
        className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <motion.section variants={riseChild} className="space-y-4 px-5 py-4">
          <div className="space-y-1.5">
            <label htmlFor="assessment-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="assessment-name"
              value={name}
              maxLength={EVALS_ASSESSMENT_LIMITS.name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="assessment-stage" className="text-sm font-medium">
                Session
              </label>
              <select
                id="assessment-stage"
                value={stage}
                disabled={locked}
                onChange={(e) => setStage(e.target.value as EvalsAssessmentStage)}
                className={SELECT}
              >
                {EVALS_ASSESSMENT_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="assessment-audience" className="text-sm font-medium">
                Group
              </label>
              <select
                id="assessment-audience"
                value={audience}
                disabled={locked}
                onChange={(e) => setAudience(e.target.value as EvalsAssessmentAudience)}
                className={SELECT}
              >
                {EVALS_ASSESSMENT_AUDIENCES.map((a) => (
                  <option key={a} value={a}>
                    {AUDIENCE_LABELS[a]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-3.5 shrink-0 accent-brand"
            />
            Active — offered for scoring on the eVals page
          </label>
        </motion.section>

        {criteria.map((c, i) => (
          <motion.div key={c.key} variants={riseChild} className="px-5 py-4">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-6 shrink-0 text-sm text-muted-foreground">{i + 1}.</span>
              <div className="flex-1 space-y-3">
                <Input
                  aria-label={`Criterion ${i + 1} name`}
                  placeholder="Criterion"
                  value={c.name}
                  maxLength={EVALS_ASSESSMENT_LIMITS.criterionName}
                  onChange={(e) => change(c.key, { name: e.target.value })}
                />
                <Textarea
                  aria-label={`Criterion ${i + 1} description`}
                  placeholder="What a judge should look for"
                  value={c.description}
                  maxLength={EVALS_ASSESSMENT_LIMITS.description}
                  onChange={(e) => change(c.key, { description: e.target.value })}
                />
                {c.scored && (
                  <p className="text-xs text-muted-foreground">
                    Already scored. Removing it stops it being asked; the scores given keep it.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move criterion ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move criterion ${i + 1} down`}
                  disabled={i === criteria.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove criterion ${i + 1}`}
                  disabled={criteria.length === 1}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setCriteria((list) => list.filter((x) => x.key !== c.key))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          </motion.div>
        ))}
        <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3 px-5 py-4">
          <Button
            variant="outline"
            disabled={criteria.length >= EVALS_ASSESSMENT_LIMITS.criteria}
            onClick={() => setCriteria((list) => [...list, { key: newKey(), name: "", description: "", scored: false }])}
          >
            <Plus />
            Add criterion
          </Button>
          <span className="text-sm text-muted-foreground">
            {criteria.length} {criteria.length === 1 ? "criterion" : "criteria"}, each scored 1 to 4
          </span>
        </motion.div>
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="brand" disabled={!canSave || busy !== null} onClick={save}>
          {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}
          {assessment ? "Save" : "Create"}
        </Button>
        {assessment && !locked && (
          <Button
            variant="ghost"
            disabled={busy !== null}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={remove}
          >
            {busy === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Remove assessment
          </Button>
        )}
      </motion.div>
    </motion.div>
  );
}

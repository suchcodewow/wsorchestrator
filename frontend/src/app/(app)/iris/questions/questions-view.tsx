"use client";

/**
 * One subject's question bank: which questions are approved, how each has
 * performed live, and the review of any one of them. A question is served to
 * takers only once it is approved.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, CheckCheck, Eye, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { IRIS_NOTE_MAX, type IrisReviewStatus } from "@/db/schema";
import { ENGINE, LEVELS, type Level } from "@/lib/iris/engine";
import type { Calibration, QuestionRow } from "@/lib/iris/questions";
import { LEVEL_LABELS, SUBJECTS, SUBJECT_KEYS, type SubjectKey } from "@/lib/iris/subjects";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { LevelBadge } from "../level-badge";

type Row = Omit<QuestionRow, "review"> & { review: Omit<QuestionRow["review"], "updatedAt"> & { updatedAt: string | null } };

const STATUS_LABELS: Record<IrisReviewStatus, string> = { approved: "Approved", rejected: "Needs work", draft: "Draft" };
const STATUS_TONE: Record<IrisReviewStatus, string> = {
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  draft: "bg-muted text-muted-foreground",
};
const LETTERS = "ABCD";

function hrefFor(subject: SubjectKey, level: Level | null, status: IrisReviewStatus | null) {
  const p = new URLSearchParams({ subject });
  if (level) p.set("level", String(level));
  if (status) p.set("status", status);
  return `/iris/questions?${p}`;
}

export function QuestionsView({
  subject,
  level,
  status,
  counts,
  questions,
}: {
  subject: SubjectKey;
  level: Level | null;
  status: IrisReviewStatus | null;
  counts: Record<IrisReviewStatus, number>;
  questions: Row[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Row | null>(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = counts.approved + counts.rejected + counts.draft;
  const live = counts.approved >= ENGINE.MIN;

  async function approveDrafts() {
    setApproving(true);
    setError(null);
    try {
      const res = await fetch("/api/iris/questions/approve-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject }),
      });
      if (!res.ok) throw new Error(`Could not approve (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve");
    } finally {
      setApproving(false);
    }
  }

  return (
    <motion.div variants={staggerParent(0.04)} initial="hidden" animate="show" className="space-y-6">
      <motion.nav variants={riseChild} className="flex flex-wrap gap-1.5" aria-label="Subjects">
        {SUBJECT_KEYS.map((k) => (
          <Link
            key={k}
            href={hrefFor(k, null, null)}
            aria-current={k === subject ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              k === subject
                ? "border-brand bg-brand-subtle text-brand"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {SUBJECTS[k].short}
          </Link>
        ))}
      </motion.nav>

      <motion.div variants={riseChild} className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">{SUBJECTS[subject].name}</h2>
          <p className="text-sm text-muted-foreground tnum">
            {counts.approved} of {total} approved
            {counts.rejected > 0 && <> · {counts.rejected} {counts.rejected === 1 ? "needs" : "need"} work</>} ·{" "}
            {live ? "open to takers" : `needs ${ENGINE.MIN} approved to open`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/iris/tests/${subject}?mode=preview`}>
              <Eye />
              Preview
            </Link>
          </Button>
          <Button variant="brand" size="sm" onClick={() => void approveDrafts()} disabled={approving || counts.draft === 0}>
            {approving ? <Loader2 className="animate-spin" /> : <CheckCheck />}
            {counts.draft === 0 ? "No drafts" : `Approve ${counts.draft} ${counts.draft === 1 ? "draft" : "drafts"}`}
          </Button>
        </div>
      </motion.div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <Filter label="Level">
          <FilterLink href={hrefFor(subject, null, status)} active={level === null}>
            All
          </FilterLink>
          {LEVELS.map((lv) => (
            <FilterLink key={lv} href={hrefFor(subject, lv, status)} active={level === lv}>
              {LEVEL_LABELS[lv]}
            </FilterLink>
          ))}
        </Filter>
        <Filter label="Review">
          <FilterLink href={hrefFor(subject, level, null)} active={status === null}>
            All
          </FilterLink>
          {(["draft", "approved", "rejected"] as const).map((s) => (
            <FilterLink key={s} href={hrefFor(subject, level, s)} active={status === s}>
              {STATUS_LABELS[s]}
            </FilterLink>
          ))}
        </Filter>
      </motion.div>

      <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
        {questions.length === 0 && <p className="px-5 py-8 text-center text-muted-foreground">No questions match.</p>}
        {questions.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={() => setOpen(q)}
            className="flex w-full cursor-pointer flex-col gap-2 px-5 py-4 text-left transition-colors hover:bg-muted/30 sm:flex-row sm:items-start sm:gap-5"
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{q.id}</span>
                <LevelBadge level={q.level} />
                <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", STATUS_TONE[q.review.status])}>
                  {STATUS_LABELS[q.review.status]}
                </span>
                <span className="text-xs text-muted-foreground">{q.subtopic}</span>
              </div>
              <p className="line-clamp-2">{q.stem}</p>
            </div>
            <div className="shrink-0 space-y-1 text-xs text-muted-foreground sm:w-72 sm:text-right">
              <p className="tnum">
                {q.stats.responses === 0 ? (
                  "No live answers yet"
                ) : (
                  <>
                    {q.stats.responses} answered · {Math.round((q.stats.correct / q.stats.responses) * 100)}% right ·{" "}
                    {Math.round((q.stats.dontKnow / q.stats.responses) * 100)}% didn&apos;t know
                  </>
                )}
              </p>
              <CalibrationNote calibration={q.calibration} />
            </div>
          </button>
        ))}
      </motion.div>

      <ReviewDialog row={open} onClose={() => setOpen(null)} />
    </motion.div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-md px-2 py-1 transition-colors",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function CalibrationNote({ calibration }: { calibration: Calibration }) {
  switch (calibration.kind) {
    case "needs_responses":
      return <p>Needs {calibration.more} more to calibrate</p>;
    case "healthy":
      return <p className="text-emerald-700 dark:text-emerald-400">Healthy for its level</p>;
    case "too_easy":
      return <p className="text-amber-700 dark:text-amber-400">Too easy for its level</p>;
    case "too_hard":
      return <p className="text-amber-700 dark:text-amber-400">Too hard for its level</p>;
    case "dead_distractors":
      return (
        <p className="text-rose-700 dark:text-rose-400">
          Nobody picks {calibration.options.map((i) => LETTERS[i]).join(", ")}: rewrite{" "}
          {calibration.options.length === 1 ? "it" : "them"}
        </p>
      );
  }
}

function ReviewDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<IrisReviewStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shownFor, setShownFor] = useState<string | null>(null);

  if (row && shownFor !== row.id) {
    setShownFor(row.id);
    setNote(row.review.note);
    setError(null);
  }

  async function save(status: IrisReviewStatus) {
    if (!row) return;
    setSaving(status);
    setError(null);
    try {
      const res = await fetch(`/api/iris/questions/${encodeURIComponent(row.id)}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      if (!res.ok) throw new Error(`Could not save (${res.status})`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm">{row.id}</span>
                <LevelBadge level={row.level} />
                <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", STATUS_TONE[row.review.status])}>
                  {STATUS_LABELS[row.review.status]}
                </span>
              </DialogTitle>
              <DialogDescription>
                {row.subtopic} · version {row.version}
                {row.review.reviewer && (
                  <>
                    {" "}
                    · last reviewed by {row.review.reviewer}
                    {row.review.updatedAt && <> on {new Date(row.review.updatedAt).toLocaleDateString()}</>}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            <p className="leading-relaxed font-medium">{row.stem}</p>

            <div className="divide-y overflow-hidden rounded-lg border text-sm">
              {row.options.map((o, i) => (
                <div
                  key={i}
                  className={cn("flex items-start gap-3 px-4 py-3", i === row.answer && "bg-emerald-500/10")}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded font-mono text-xs",
                      i === row.answer ? "bg-emerald-600 text-white" : "border text-muted-foreground",
                    )}
                  >
                    {LETTERS[i]}
                  </span>
                  <span className="flex-1">{o}</span>
                  {row.stats.responses > 0 && (
                    <span className="shrink-0 text-xs text-muted-foreground tnum">{row.stats.picks[i]} picked</span>
                  )}
                </div>
              ))}
            </div>

            <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm">
              <p className="text-xs font-medium text-muted-foreground">Why it is the answer</p>
              <p className="mt-1">{row.rationale}</p>
            </div>

            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Reviewer note</span>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={IRIS_NOTE_MAX}
                rows={3}
                placeholder="Optional"
              />
            </label>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                variant="ghost"
                onClick={() => void save("draft")}
                disabled={saving !== null || row.review.status === "draft"}
              >
                {saving === "draft" ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                Back to draft
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void save("rejected")} disabled={saving !== null}>
                  {saving === "rejected" ? <Loader2 className="animate-spin" /> : <X />}
                  Needs work
                </Button>
                <Button variant="brand" onClick={() => void save("approved")} disabled={saving !== null}>
                  {saving === "approved" ? <Loader2 className="animate-spin" /> : <Check />}
                  Approve
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

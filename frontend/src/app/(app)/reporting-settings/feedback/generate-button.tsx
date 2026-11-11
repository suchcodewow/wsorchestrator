"use client";

/**
 * Generates one class's participation scores and comments, then everyone's
 * blank overall feedback, after saying what it will write and whom it leaves
 * out. Its count is the blank comments there are marks or feedback to fill,
 * which its tooltip spells out; it still runs at zero when scores are waiting.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { StagePending } from "@/lib/evals/participation";
import type { ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { Hint } from "./hint";

const ERRORS: Record<string, string> = {
  no_bootcamp: "No bootcamp is active.",
  no_intermediate: "The active bootcamp has no intermediate class.",
  released: "This class has already been released.",
  no_assessment: "The Participation assessment is not set up on this database.",
  unconfigured: "Claude is not set up on this deployment.",
  upstream: "Claude could not write these just now. Try again.",
};

export function GenerateButton({
  stage,
  pending,
}: {
  stage: ReleaseStage;
  /** What pressing it would write; null when it cannot run. */
  pending: StagePending | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = `Generate ${STAGE_LABELS[stage]} Feedback`;
  const marks = pending?.comments ?? 0;
  const overall = pending?.overall ?? 0;
  const comments = marks + overall;
  const scores = pending?.scores ?? 0;
  const why = !pending
    ? "The Participation assessment is not set up on this database"
    : comments === 0 && scores === 0
      ? "Nothing is waiting to be generated"
      : null;
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  async function submit() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/reporting/bootcamp/participation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not generate (${res.status}).`);
        return;
      }
      router.refresh();
      if (body.overall?.error) {
        setError(ERRORS[body.overall.error] ?? "Claude could not write the overall feedback. Press Generate again to retry.");
        return;
      }
      const failed = body.failed + (body.overall?.failed ?? 0);
      if (failed > 0) {
        setError(`Claude could not write comments for ${failed} of them. Press Generate again to retry.`);
        return;
      }
      setOpen(false);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Hint
        disabled={why !== null}
        content={
          <>
            <p>
              ({comments.toLocaleString()}) counts the blank comments Claude can write:{" "}
              {plural(marks, "participation comment", "participation comments")} from marks, and{" "}
              {plural(overall, "overall feedback box", "overall feedback boxes")} summed up from each person&apos;s assessments.
              {scores > 0 && ` It also fills in ${plural(scores, "participation score", "participation scores")}.`}
            </p>
            {why && <p className="text-muted-foreground">{why}.</p>}
          </>
        }
      >
        <Button
          variant="outline"
          size="sm"
          disabled={why !== null}
          aria-label={`${label}: ${plural(comments, "comment", "comments")} to write`}
          onClick={() => setOpen(true)}
        >
          <Sparkles />
          Generate feedback ({comments.toLocaleString()})
        </Button>
      </Hint>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}?</DialogTitle>
            <DialogDescription>
              Claude writes {plural(marks, "blank participation comment", "blank participation comments")}, and {scores.toLocaleString()}{" "}
              participation {scores === 1 ? "score goes" : "scores go"} into the overall score. Then it sums up each person&apos;s
              assessment feedback into their blank overall positive and constructive feedback, {overall.toLocaleString()} so far. Comments
              and scores already saved stay as they are.
            </DialogDescription>
          </DialogHeader>
          {pending && pending.skipped.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">Skipped: {pending.skipped.length.toLocaleString()} with no RSVP, marks or assessment</p>
              <p className="text-muted-foreground">{pending.skipped.join(", ")}</p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={running} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="brand" disabled={running} onClick={submit}>
              {running ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {running ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

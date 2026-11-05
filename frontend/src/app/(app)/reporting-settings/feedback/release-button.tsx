"use client";

/**
 * Releases one class of the active bootcamp to managers, after saying what
 * that means. It waits until everyone in the class has a score on every
 * assessment, an exit exam, and overall positive and constructive feedback,
 * and its tooltip names who is still waiting on each. Once released, it
 * opens the log of the Slack message to the class's managers as it goes.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { ReleaseBlockers, Waiting } from "@/lib/reporting/bootcamp";
import { RELEASE_LABELS, type ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { formatDate } from "../../cohort-settings/format";
import { Hint } from "./hint";

const ERRORS: Record<string, string> = {
  unscored: "Someone in this class is still waiting on a score. Reload to see who.",
  no_exit_exam: "Someone in this class is still waiting on an exit exam. Reload to see who.",
  no_feedback: "Someone in this class is still waiting on overall feedback. Reload to see who.",
};

/** What the tooltip heads each kind of wait with. */
const WAITING_ON: Record<keyof ReleaseBlockers, string> = {
  unscored: "Waiting on a score",
  noExitExam: "Waiting on an exit exam",
  noFeedback: "Waiting on overall feedback",
};

function WaitingList({ heading, waiting }: { heading: string; waiting: Waiting }) {
  const more = waiting.total - waiting.names.length;
  return (
    <div>
      <p className="font-medium">{heading}</p>
      <p>
        {waiting.names.join(", ")}
        {more > 0 && `, and ${more.toLocaleString()} more`}
      </p>
    </div>
  );
}

export function ReleaseButton({
  stage,
  startDate,
  blockers,
  slackLive,
}: {
  stage: ReleaseStage;
  /** The active bootcamp's first day. */
  startDate: string;
  /** Who in the class is still waiting on a score, an exit exam or overall feedback; null when that is not known here. */
  blockers: ReleaseBlockers | null;
  /** Whether Slack is live, so the message is sent rather than only logged. */
  slackLive: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = STAGE_LABELS[stage];

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/reporting/bootcamp/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(ERRORS[body?.error ?? ""] ?? `Could not release (${res.status})`);
      }
      const body = await res.json().catch(() => null);
      setOpen(false);
      if (body?.notice?.runId) router.push(`/reporting-settings/feedback/${body.notice.runId}`);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release");
    } finally {
      setPending(false);
    }
  }

  const waits = blockers
    ? (Object.keys(WAITING_ON) as (keyof ReleaseBlockers)[]).filter((k) => blockers[k].total > 0)
    : [];
  const blocked = waits.length > 0;

  return (
    <>
      <Hint
        disabled={blocked}
        content={
          blocked ? (
            <div className="space-y-2">
              {waits.map((k) => (
                <WaitingList key={k} heading={WAITING_ON[k]} waiting={blockers![k]} />
              ))}
            </div>
          ) : (
            <p>Shows managers the {label} results. It cannot be taken back.</p>
          )
        }
      >
        <Button size="sm" onClick={() => setOpen(true)} disabled={blocked} aria-label={RELEASE_LABELS[stage]}>
          <Send />
          Release scores
        </Button>
      </Hint>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{RELEASE_LABELS[stage]}?</DialogTitle>
            <DialogDescription>
              Managers will see the {label} results of the bootcamp starting {formatDate(startDate)} for the people
              in their org, on Live Sessions and each person&apos;s page. Everyone scored in {label} gets{" "}
              {formatDate(startDate)} as their {label} date in bootcamp history, with their scores, which completes
              the class. Everyone in their management chains, and the Additional Slack Contacts,{" "}
              {slackLive
                ? "gets a Slack message linking to Live Sessions."
                : "would get a Slack message linking to Live Sessions, but Slack is in dry run, so it is only logged."}{" "}
              Only release once every assessment is in; a release cannot be taken back.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? "Releasing…" : `Release ${label} scores`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

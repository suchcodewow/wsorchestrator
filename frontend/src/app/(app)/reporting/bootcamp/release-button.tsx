"use client";

/**
 * Releases one class of the active bootcamp to managers, after saying what
 * that means. It waits until every assessment in the class has a score, and
 * its tooltip names who is still waiting on one.
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
import { RELEASE_LABELS, STAGE_CODES, type ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { formatDate } from "../../cohort-settings/format";
import { Hint } from "./hint";

const ERRORS: Record<string, string> = {
  unscored: "Someone in this class is still waiting on a score. Reload to see who.",
};

export function ReleaseButton({
  stage,
  startDate,
  unscored,
}: {
  stage: ReleaseStage;
  /** The active bootcamp's first day. */
  startDate: string;
  /** Who in the class is still waiting on a score; null when that is not known here. */
  unscored: { total: number; names: string[] } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = STAGE_CODES[stage];

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
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release");
    } finally {
      setPending(false);
    }
  }

  const waiting = unscored?.total ?? 0;
  const more = waiting - (unscored?.names.length ?? 0);

  return (
    <>
      <Hint
        disabled={waiting > 0}
        content={
          waiting > 0 ? (
            <>
              <p className="font-medium">Waiting on a score</p>
              <p>
                {unscored!.names.join(", ")}
                {more > 0 && `, and ${more.toLocaleString()} more`}
              </p>
            </>
          ) : (
            <p>Shows managers the {code} results. It cannot be taken back.</p>
          )
        }
      >
        <Button size="sm" onClick={() => setOpen(true)} disabled={waiting > 0} aria-label={RELEASE_LABELS[stage]}>
          <Send />
          Release scores
        </Button>
      </Hint>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{RELEASE_LABELS[stage]}?</DialogTitle>
            <DialogDescription>
              Managers will see the {code} results of the bootcamp starting {formatDate(startDate)} for the people
              in their org, here and on each person&apos;s page. Everyone scored in {code} gets{" "}
              {formatDate(startDate)} as their {code} date in bootcamp history, with their scores, which completes
              the class. Only release once every assessment is in; a release cannot be taken back.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? "Releasing…" : `Release ${code} scores`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

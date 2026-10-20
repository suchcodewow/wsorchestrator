"use client";

/**
 * Releases one class of the active bootcamp to managers, after saying what
 * that means. Once released it says when, and cannot be pressed again.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Send } from "lucide-react";
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
import { formatDate, formatWhen } from "../../cohort-settings/format";

export function ReleaseButton({
  stage,
  startDate,
  released,
  unavailable,
}: {
  stage: ReleaseStage;
  /** The active bootcamp's first day; null with none active. */
  startDate: string | null;
  released: { at: string; byName: string | null } | null;
  /** Why it cannot be pressed, when it cannot. */
  unavailable: string | null;
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
      if (!res.ok) throw new Error(`Could not release (${res.status})`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release");
    } finally {
      setPending(false);
    }
  }

  if (released) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        title={`Released ${formatWhen(released.at)}${released.byName ? ` by ${released.byName}` : ""}`}
      >
        <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" />
        {code} released {formatDate(released.at.slice(0, 10))}
      </Button>
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={unavailable !== null} title={unavailable ?? undefined}>
        <Send />
        {RELEASE_LABELS[stage]}
      </Button>

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

"use client";

/** Moves an event's end time to now, after confirming what that starts. */

import { useState } from "react";
import { CalendarX, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RunStatus, WorkshopRun } from "@/db/schema";

const ERRORS: Record<string, string> = {
  not_found: "This event no longer exists.",
  not_running:
    "This event isn't running, so there is no end time left to bring forward.",
  unauthorized: "Sign in again to end this event.",
};

export function EndNowButton({
  run,
  owned,
  onEnded,
}: {
  run: WorkshopRun;
  owned: boolean;
  onEnded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only a live event has an end time the reaper acts on; every other status is
  // either not built yet or already on its way out.
  if ((run.status as RunStatus) !== "ready" || run.deleteRequested) return null;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${run.id}/end`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(ERRORS[body?.error] ?? `Could not end (${res.status})`);
      }
      setOpen(false);
      onEnded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not end");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <CalendarX />
        End now
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End “{run.name}” now?</DialogTitle>
            <DialogDescription>
              This sets the end time to now, so everything the {run.mode} built
              is torn down within a few minutes — the same teardown that would
              have run at{" "}
              {run.expiresAt
                ? new Date(run.expiresAt).toLocaleString()
                : "the scheduled end"}
              . Attendees lose access, and the event stays on record with its
              build log.
            </DialogDescription>
          </DialogHeader>

          {!owned && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/8 px-3 py-2 text-sm">
              This event belongs to someone else and they are not asked first.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? "Ending…" : "End now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

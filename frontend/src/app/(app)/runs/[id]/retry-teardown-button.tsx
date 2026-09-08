"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RunStatus, WorkshopRun } from "@/db/schema";

const ERRORS: Record<string, string> = {
  not_found: "This event no longer exists.",
  not_retryable:
    "This teardown isn't in a failed state anymore — it may already be running again.",
  unauthorized: "Sign in again to retry this teardown.",
};

/**
 * Restart a teardown that gave up.
 *
 * Shown only in `destroy_failed`, the one state where the reaper has stopped on
 * its own and is waiting to be told to try again. Not to be confused with
 * `RetryEventButton`, which re-runs a failed provision — that one builds, this
 * one removes, and showing both at once is impossible because no run is in
 * `failed` and `destroy_failed` at the same time.
 */
export function RetryTeardownButton({
  run,
  onRetried,
}: {
  run: WorkshopRun;
  /** The teardown is queued again — the run is back to destroying. */
  onRetried: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if ((run.status as RunStatus) !== "destroy_failed") return null;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${run.id}/retry-teardown`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          ERRORS[body?.error] ?? `Could not retry teardown (${res.status})`,
        );
      }
      onRetried();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not retry teardown",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={submit} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
        {pending ? "Retrying…" : "Retry teardown"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

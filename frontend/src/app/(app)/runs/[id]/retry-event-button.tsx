"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RunStatus, WorkshopRun } from "@/db/schema";

const ERRORS: Record<string, string> = {
  not_found: "This event no longer exists.",
  not_retryable:
    "This event isn't in a failed state anymore, so there's nothing to retry.",
  trigger_failed:
    "Couldn't start the runner just now. Nothing changed — try again in a moment.",
  unauthorized: "Sign in again to retry this event.",
};

/**
 * Re-run a failed provision. Shown only when the run actually failed — a
 * first-provision failure lands in `failed` (a live workshop's grow failure is
 * left `ready` instead), and its half-built resources are adopted on the retry,
 * so re-running converges rather than duplicating. Rendered for the owner and
 * for a manager or above; the API checks the same thing again.
 */
export function RetryEventButton({
  run,
  onRetried,
}: {
  run: WorkshopRun;
  /** The retry kicked off — the run is provisioning again. */
  onRetried: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if ((run.status as RunStatus) !== "failed" || run.deleteRequested) {
    return null;
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${run.id}/retry`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(ERRORS[body?.error] ?? `Could not retry (${res.status})`);
      }
      onRetried();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not retry");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={submit} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        {pending ? "Retrying…" : "Retry"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

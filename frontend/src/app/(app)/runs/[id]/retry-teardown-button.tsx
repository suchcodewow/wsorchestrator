"use client";

/** Restarts a teardown that gave up. */

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

export function RetryTeardownButton({
  run,
  onRetried,
}: {
  run: WorkshopRun;
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

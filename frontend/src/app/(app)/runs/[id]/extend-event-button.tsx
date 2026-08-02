"use client";

import { useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RunStatus, WorkshopRun } from "@/db/schema";

const ERRORS: Record<string, string> = {
  not_found: "This event no longer exists.",
  not_extendable:
    "This event is being torn down, so there is nothing left to extend.",
  unauthorized: "Sign in again to extend this event.",
};

/** Statuses where the event is on its way out and can't be extended. */
const GONE = new Set<RunStatus>(["destroying", "destroyed", "failed"]);

/**
 * Add one day to an event's lifetime. Rendered for the owner and for a manager
 * or above; the API checks the same thing again, so this only decides what is
 * worth showing. Hidden entirely once the event is tearing down.
 */
export function ExtendEventButton({
  run,
  onExtended,
}: {
  run: WorkshopRun;
  /** The extension landed — the run has a new expiry and a new log line. */
  onExtended: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (GONE.has(run.status as RunStatus) || run.deleteRequested) return null;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${run.id}/extend`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          ERRORS[body?.error] ?? `Could not extend (${res.status})`,
        );
      }
      onExtended();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not extend");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={submit} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <CalendarPlus />}
        {pending ? "Extending…" : "Extend a day"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

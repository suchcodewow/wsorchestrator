"use client";

/** The preferences a person sets for themselves; for now, whether page tours play for them again. */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PreferencesView() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resetTours() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/tours/seen", { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { reset?: number } | null;
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setDone(body?.reset ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the tours.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="divide-y rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
        <div className="text-sm">
          <span className="font-medium">Page tours</span>
          {done !== null && (
            <span role="status" className="ml-2 text-muted-foreground">
              {done === 1 ? "1 tour" : `${done} tours`} will play again.
            </span>
          )}
          {error && (
            <span role="alert" className="ml-2 text-destructive">
              {error}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={resetTours}>
          {busy && <Loader2 className="animate-spin" />}
          Reset all tours
        </Button>
      </div>
    </div>
  );
}

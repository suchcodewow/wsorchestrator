"use client";

/**
 * Starting a schedule as a copy of an earlier bootcamp's. It replaces what the
 * schedule holds, so that is asked first when it holds anything.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CopySource, FillSummary } from "@/lib/scheduler/schedule";
import { formatDate } from "../../cohort-settings/format";

const ERRORS: Record<string, string> = {
  invalid: "Pick a bootcamp to copy.",
  not_found: "That bootcamp was removed — reload the page.",
  has_sessions: "It has a schedule already. Tick the box to replace it.",
  same_bootcamp: "Pick another bootcamp.",
  forbidden: "Your role changed — reload the page.",
};

export function CopyDialog({
  open,
  onClose,
  bootcampId,
  sessionCount,
  sources,
  flush,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  bootcampId: string;
  sessionCount: number;
  sources: CopySource[];
  flush: () => Promise<boolean>;
  onDone: () => Promise<void>;
}) {
  const [copyId, setCopyId] = useState(sources[0]?.id ?? "");
  const [replace, setReplace] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<FillSummary | null>(null);

  const [was, setWas] = useState(open);
  if (open !== was) {
    setWas(open);
    if (open) {
      setCopyId(sources[0]?.id ?? "");
      setReplace(false);
      setError(null);
      setSummary(null);
    }
  }

  async function run() {
    if (sessionCount > 0 && !replace) return setError(`Tick the box to replace its ${sessionCount} sessions.`);
    if (!copyId) return setError(ERRORS.invalid!);
    setPending(true);
    setError(null);
    try {
      await flush();
      const res = await fetch(`/api/scheduler/bootcamps/${bootcampId}/schedule/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: copyId, replace }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) return setError(ERRORS[out?.error ?? ""] ?? `Could not fill it (${res.status}).`);
      setSummary(out as FillSummary);
      await onDone();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{summary ? `Added ${summary.sessions} session${summary.sessions === 1 ? "" : "s"}` : "Copy a schedule"}</DialogTitle>
        </DialogHeader>

        {summary ? (
          <>
            {summary.notes.length > 0 ? (
              <ul className="grid list-disc gap-1.5 pl-5 text-sm">
                {summary.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Everything came across.</p>
            )}
            <DialogFooter>
              <Button variant="brand" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
            className="grid gap-5"
          >
            <div className="grid gap-1.5">
              <label htmlFor="copy-from" className="text-sm font-medium">
                Bootcamp
              </label>
              <select
                id="copy-from"
                value={copyId}
                onChange={(e) => setCopyId(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    Starting {formatDate(s.startDate)} ({s.sessions} sessions)
                  </option>
                ))}
              </select>
            </div>

            {sessionCount > 0 && (
              <label className="flex items-start gap-2.5 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-800/60 dark:bg-amber-950/30">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5 size-4 accent-brand" />
                <span>
                  Replace its {sessionCount} session{sessionCount === 1 ? "" : "s"}, and their comments
                </span>
              </label>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="brand" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Copy it
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

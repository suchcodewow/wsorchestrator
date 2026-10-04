"use client";

/**
 * Filling a schedule in one go: as a copy of an earlier bootcamp's, or from
 * an export of the Google Sheet's Schedule tab, its times rounded to the
 * quarter hour. Either replaces what the schedule holds, so that is asked
 * first when it holds anything.
 */

import { useState } from "react";
import { Copy, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CopySource, FillSummary } from "@/lib/scheduler/schedule";
import { cn } from "@/lib/utils";
import { formatDate } from "../../cohort-settings/format";

const ERRORS: Record<string, string> = {
  invalid: "Pick a bootcamp to copy.",
  not_found: "That bootcamp was removed — reload the page.",
  has_sessions: "It has a schedule already. Tick the box to replace it.",
  same_bootcamp: "Pick another bootcamp.",
  no_file: "Pick a file.",
  too_large: "That file is over 20 MB.",
  unreadable: "That file could not be read as a spreadsheet.",
  not_schedule: "That sheet does not look like the Schedule tab.",
  forbidden: "Your role changed — reload the page.",
};

type Source = "copy" | "import";

export function FillDialog({
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
  const [from, setFrom] = useState<Source>(sources.length > 0 ? "copy" : "import");
  const [copyId, setCopyId] = useState(sources[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<FillSummary | null>(null);

  const [was, setWas] = useState(open);
  if (open !== was) {
    setWas(open);
    if (open) {
      setFrom(sources.length > 0 ? "copy" : "import");
      setCopyId(sources[0]?.id ?? "");
      setFile(null);
      setReplace(false);
      setError(null);
      setSummary(null);
    }
  }

  async function run() {
    if (sessionCount > 0 && !replace) return setError(`Tick the box to replace its ${sessionCount} sessions.`);
    if (from === "copy" && !copyId) return setError(ERRORS.invalid!);
    if (from === "import" && !file) return setError(ERRORS.no_file!);
    setPending(true);
    setError(null);
    try {
      await flush();
      let res: Response;
      if (from === "copy") {
        res = await fetch(`/api/scheduler/bootcamps/${bootcampId}/schedule/copy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: copyId, replace }),
        });
      } else {
        const form = new FormData();
        form.set("file", file!);
        form.set("replace", String(replace));
        res = await fetch(`/api/scheduler/bootcamps/${bootcampId}/schedule/import`, { method: "POST", body: form });
      }
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
          <DialogTitle>{summary ? `Added ${summary.sessions} session${summary.sessions === 1 ? "" : "s"}` : "Import or copy a schedule"}</DialogTitle>
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
            <div role="radiogroup" aria-label="Fill it from" className="grid gap-2 sm:grid-cols-2">
              <Choice on={from === "copy"} disabled={sources.length === 0} onPick={() => setFrom("copy")} icon={<Copy className="size-4" />}>
                <div className="text-sm font-medium">An earlier bootcamp</div>
                <div className="text-xs text-muted-foreground">
                  {sources.length === 0 ? "None has a schedule yet" : `${sources.length} with a schedule`}
                </div>
              </Choice>
              <Choice on={from === "import"} onPick={() => setFrom("import")} icon={<FileSpreadsheet className="size-4" />}>
                <div className="text-sm font-medium">The Google Sheet</div>
                <div className="text-xs text-muted-foreground">Its Schedule tab, as .xlsx or .csv</div>
              </Choice>
            </div>

            {from === "copy" ? (
              <div className="grid gap-1.5">
                <label htmlFor="fill-from" className="text-sm font-medium">
                  Bootcamp
                </label>
                <select
                  id="fill-from"
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
            ) : (
              <div className="grid gap-1.5">
                <label htmlFor="fill-file" className="text-sm font-medium">
                  File
                </label>
                <input
                  id="fill-file"
                  type="file"
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="text-sm file:mr-3 file:rounded-md file:border file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent"
                />
                <p className="text-xs text-muted-foreground">Times are rounded to the quarter hour; every session keeps at least 15 minutes.</p>
              </div>
            )}

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
                {from === "copy" ? "Copy it" : "Import it"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Choice({
  on,
  disabled,
  onPick,
  icon,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onPick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        on ? "border-brand-border bg-brand/8" : "hover:bg-accent/40",
      )}
    >
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span>{children}</span>
    </button>
  );
}

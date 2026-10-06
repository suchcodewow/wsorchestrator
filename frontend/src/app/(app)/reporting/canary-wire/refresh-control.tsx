"use client";

/**
 * How the Canary Wire's pull from Mindtickle stands, and Refresh now.
 *
 * Cloud Scheduler pulls every two hours on its own and takes the steps; this
 * only shows how far one has got and reloads the month when it ends. Refresh
 * now is for testing — locally there is no scheduler — and the page takes
 * the steps of a pull started that way itself, one after another, picking it
 * up again after a reload.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import type { PullSummary } from "@/lib/canary-wire/pull";
import { PILL } from "./ui";

const POLL_MS = 3_000;

const START_ERRORS: Record<string, string> = {
  running: "A pull is already running.",
  not_configured: "Mindtickle isn't configured on this server.",
  forbidden: "Your own role changed — reload the page.",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function RefreshControl({ configured, initial }: { configured: boolean; initial: PullSummary | null }) {
  const router = useRouter();
  const [pull, setPull] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const driving = useRef(false);
  const running = pull?.status === "running";

  const read = useCallback(async (): Promise<PullSummary | null> => {
    const res = await fetch("/api/evals/canary-wire/pull", { cache: "no-store" });
    if (!res.ok) throw new Error(`the server returned ${res.status}`);
    return ((await res.json()) as { pull: PullSummary | null }).pull;
  }, []);

  const drive = useCallback(async () => {
    if (driving.current) return;
    driving.current = true;
    try {
      let current = await read();
      while (current?.status === "running") {
        if (current.working) {
          // Another step has it; wait for it to let go rather than knock.
          await sleep(POLL_MS);
          current = await read();
        } else {
          const res = await fetch("/api/evals/canary-wire/pull/step", { method: "POST" });
          if (!res.ok) throw new Error(`the server returned ${res.status}`);
          current = ((await res.json()) as { pull: PullSummary | null }).pull;
        }
        setPull(current);
      }
    } catch (err) {
      setError(`Lost track of the pull — ${(err as Error).message}. Reload to pick it up again.`);
    } finally {
      driving.current = false;
    }
  }, [read]);

  // While a pull runs, show how far it has got, whoever is taking its steps,
  // and reload the month once it has succeeded.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      read().then((next) => {
        setPull(next);
        if (next?.status === "succeeded") router.refresh();
      }, () => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, read, router]);

  // A pull started by hand is this page's to step, so pick it up after a reload.
  useEffect(() => {
    if (initial?.status !== "running" || initial.trigger !== "manual") return;
    const timer = setTimeout(() => void drive(), 0);
    return () => clearTimeout(timer);
  }, [initial?.status, initial?.trigger, drive]);

  async function start() {
    setError(null);
    const res = await fetch("/api/evals/canary-wire/pull", { method: "POST" });
    const out = (await res.json().catch(() => ({}))) as { pull?: PullSummary; error?: string };
    if (!res.ok) {
      setError(START_ERRORS[out.error ?? ""] ?? `Could not start it (${res.status}).`);
      return;
    }
    if (out.pull) setPull(out.pull);
    void drive();
  }

  const failed = pull?.status === "failed" ? pull.error : null;
  return (
    <>
      {running ? (
        <span className="flex h-9 items-center gap-2 rounded-full border bg-card px-3.5 text-xs text-muted-foreground shadow-sm" role="status">
          <Loader2 className="size-3.5 animate-spin" />
          {pull.total > 0 && (
            <span className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
              <i className="block h-full bg-brand transition-[width]" style={{ width: `${(pull.done / pull.total) * 100}%` }} />
            </span>
          )}
          {pull.message}
        </span>
      ) : (
        <button
          type="button"
          className={PILL}
          disabled={!configured}
          onClick={start}
          title={
            configured
              ? "The Canary Wire pulls from Mindtickle every two hours. This pulls now instead; it takes about 15 minutes."
              : "Mindtickle isn't configured on this server: MT_API_KEY, MT_SECRET_KEY or MT_LS_URL is unset."
          }
        >
          <RefreshCw />
          Refresh now
        </button>
      )}
      {(error || failed) && (
        <span role="alert" className="text-xs text-destructive">
          {error ?? `Last pull failed — ${failed}`}
        </span>
      )}
    </>
  );
}

"use client";

/** The Sync HiBob Now button, where the credentials come from, and every run's result. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, RefreshCw, User, XCircle } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import type { HibobSyncStatus, HibobSyncTrigger } from "@/db/schema";
import type { HibobSyncSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatWhen } from "../format";

export type SyncRun = {
  id: string;
  trigger: HibobSyncTrigger;
  triggeredBy: string | null;
  status: HibobSyncStatus;
  startedAt: string;
  finishedAt: string | null;
  employeeCount: number | null;
  skipped: number | null;
  error: string | null;
};

const ERRORS: Record<string, string> = {
  not_configured:
    "HiBob credentials are not configured. Set hibob_userid and hibob_token in terraform.tfvars (and the Harness workspace) and redeploy.",
  already_running: "A sync is already running — its result will appear below.",
  rejected: "HiBob turned the service user's credentials down.",
  unreachable: "Could not reach HiBob.",
  bad_response: "HiBob answered with something unexpected.",
  forbidden: "Your own role changed — reload the page.",
};

function message(body: { error?: string; detail?: string } | null, status: number) {
  const text = ERRORS[body?.error ?? ""] ?? `Something went wrong (${status}).`;
  return body?.detail && body.error !== "rejected" ? `${text} ${body.detail}` : text;
}

function duration(run: SyncRun): string {
  if (!run.finishedAt) return "—";
  const seconds = Math.max(0, (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000);
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function HibobSyncView({
  serviceUser,
  query,
  page,
  running: syncing,
}: {
  serviceUser: string | null;
  query: ListQuery<HibobSyncSort>;
  page: Page<SyncRun>;
  /** Whether a sync is under way now, whichever page this is. */
  running: boolean;
}) {
  const runs = page.rows;
  const sortProps = { sort: query.sort, dir: query.dir };
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function syncNow() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/evals/hibob/sync", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setNotice(`Synced ${body.count.toLocaleString()} employees from HiBob.`);
      } else {
        setError(message(body, res.status));
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
      // A failed run is logged too.
      router.refresh();
    }
  }

  const running = busy || syncing;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="text-xl font-medium tracking-tight">HiBob sync</h2>
        <Button variant="brand" disabled={running} onClick={syncNow}>
          {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {running ? "Syncing…" : "Sync HiBob Now"}
        </Button>
      </motion.div>

      <motion.p variants={riseChild} className="text-sm text-muted-foreground">
        {serviceUser ? (
          <>
            Service user <span className="font-mono font-medium text-foreground">{serviceUser}</span>, from{" "}
            <code>hibob_userid</code> and <code>hibob_token</code> in the deployment.
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" />
            No HiBob credentials are configured. Set <code>hibob_userid</code> and <code>hibob_token</code> in
            terraform.tfvars and the Harness workspace, then redeploy.
          </span>
        )}
      </motion.p>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}
      {notice && (
        <motion.p variants={riseChild} role="status" className="text-sm text-muted-foreground">
          {notice}
        </motion.p>
      )}

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by who, status or error" label="Search the sync log" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="startedAt" {...sortProps}>
                  Started
                </SortHeader>
                <SortHeader column="triggeredBy" {...sortProps}>
                  Triggered by
                </SortHeader>
                <SortHeader column="status" {...sortProps}>
                  Result
                </SortHeader>
                <PlainHeader className="text-right">Took</PlainHeader>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b align-top last:border-b-0">
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">{formatWhen(run.startedAt)}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      {run.trigger === "schedule" ? (
                        <>
                          <CalendarClock className="size-3.5" />
                          Schedule
                        </>
                      ) : (
                        <>
                          <User className="size-3.5" />
                          {run.triggeredBy ?? "Someone since removed"}
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-2.5">
                    {run.status === "running" ? (
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        Running
                      </span>
                    ) : run.status === "succeeded" ? (
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        {(run.employeeCount ?? 0).toLocaleString()} employees
                        {!!run.skipped && (
                          <span className="text-muted-foreground">
                            , {run.skipped.toLocaleString()} skipped
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="flex items-start gap-1.5 text-destructive">
                        <XCircle className="mt-0.5 size-3.5 shrink-0" />
                        <span className="break-words">{run.error ?? "Failed"}</span>
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums text-muted-foreground">
                    {duration(run)}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No syncs match." : "No syncs yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="syncs" />
        </div>
      </motion.div>
    </motion.div>
  );
}

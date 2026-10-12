"use client";

/** Each job Cloud Scheduler runs, with its schedule, how it last ran, and a switch. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CheckCircle2, CircleDashed, Loader2, MinusCircle, XCircle } from "lucide-react";
import { HEADER_ROW, PlainHeader } from "@/components/data-table";
import { PillSwitch } from "@/components/pill-switch";
import type { TimedJobStatus } from "@/db/schema";
import { riseChild, staggerParent } from "@/lib/motion";
import type { TimedJobRow } from "@/lib/timed-jobs";
import { cn } from "@/lib/utils";

const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  dateStyle: "medium",
  timeStyle: "short",
});

const STATUS: Record<TimedJobStatus, { label: string; Icon: typeof CheckCircle2; className: string }> = {
  succeeded: { label: "Succeeded", Icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Failed", Icon: XCircle, className: "text-destructive" },
  running: { label: "Running", Icon: Loader2, className: "text-muted-foreground" },
  skipped: { label: "Skipped", Icon: MinusCircle, className: "text-muted-foreground" },
};

const ERRORS: Record<string, string> = {
  not_found: "That job no longer exists — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

export function TimedJobsView({ jobs }: { jobs: TimedJobRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const on = jobs.filter((job) => job.enabled).length;

  async function toggle(job: TimedJobRow, enabled: boolean) {
    setBusy(job.key);
    setError(null);
    try {
      const res = await fetch(`/api/settings/timed-jobs/${job.key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(ERRORS[body?.error ?? ""] ?? `Could not save (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1">
        <h2 className="text-xl font-medium tracking-tight">Timed Jobs</h2>
        <p className="text-sm text-muted-foreground">
          {on} of {jobs.length} jobs on. Times are Eastern.
        </p>
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <PlainHeader>Job</PlainHeader>
                <PlainHeader>Schedule</PlainHeader>
                <PlainHeader>Last run</PlainHeader>
                <PlainHeader>Result</PlainHeader>
                <PlainHeader className="w-32">On</PlainHeader>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const status = job.lastStatus ? STATUS[job.lastStatus] : null;
                return (
                  <tr key={job.key} className="border-b align-top transition-colors last:border-b-0 hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <div className="font-medium">{job.name}</div>
                      <div className="text-muted-foreground">{job.summary}</div>
                      {!job.enabled && job.offWarning && (
                        <div className="mt-1 text-destructive">{job.offWarning}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      <div>{job.schedule}</div>
                      <div className="font-mono text-xs">
                        {job.cron} · {job.timeZone}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {job.lastStartedAt ? WHEN.format(new Date(job.lastStartedAt)) : "Never"}
                    </td>
                    <td className="px-5 py-3">
                      {status ? (
                        <div>
                          <span className={cn("inline-flex items-center gap-1.5 font-medium", status.className)}>
                            <status.Icon className={cn("size-4", job.lastStatus === "running" && "animate-spin")} />
                            {status.label}
                          </span>
                          {job.lastDetail && <div className="text-muted-foreground">{job.lastDetail}</div>}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <CircleDashed className="size-4" />
                          Not run yet
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <PillSwitch
                        label={job.enabled ? "On" : "Off"}
                        title={`Turn ${job.name} ${job.enabled ? "off" : "on"}`}
                        on={job.enabled}
                        disabled={busy === job.key}
                        onChange={(next) => toggle(job, next)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>
    </motion.div>
  );
}

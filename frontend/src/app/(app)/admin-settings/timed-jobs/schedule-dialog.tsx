"use client";

/**
 * Sets when one of the app's own timed jobs runs: a preset or a cron of the
 * administrator's own, in a time zone, with the next few runs shown as it is
 * typed. Checked with the same `scheduleProblem` the server uses.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { describeCron, nextDue, parseCron, scheduleProblem, zoneName } from "@/lib/cron";
import type { TimedJobRow } from "@/lib/timed-jobs";
import { cn } from "@/lib/utils";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "UTC"];

const PRESETS = [
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Daily at 3:00 AM", cron: "0 3 * * *" },
  { label: "Weekdays at 9:00 AM", cron: "0 9 * * 1-5" },
];

const ERRORS: Record<string, string> = {
  not_found: "That job no longer exists — reload the page.",
  forbidden: "Your own role changed — reload the page.",
  fixed_schedule: "This job's schedule is set in Terraform.",
};

export function ScheduleDialog({
  job,
  onClose,
  onSaved,
}: {
  job: TimedJobRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [cron, setCron] = useState(job.cron);
  const [timeZone, setTimeZone] = useState(job.timeZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = useMemo(() => scheduleProblem(cron, timeZone), [cron, timeZone]);
  const upcoming = useMemo(() => {
    if (problem) return [];
    const parsed = parseCron(cron);
    return parsed.ok ? nextDue(parsed.cron, timeZone, new Date(), 3) : [];
  }, [cron, timeZone, problem]);
  const when = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", dateStyle: undefined, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    [timeZone],
  );
  const isDefault = cron.trim().split(/\s+/).join(" ") === job.defaultCron && timeZone === job.defaultTimeZone;
  const zones = ZONES.includes(timeZone) ? ZONES : [...ZONES, timeZone];

  async function save(schedule: { cron: string; timeZone: string } | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/settings/timed-jobs/${job.key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error === "invalid_schedule" ? (body.detail ?? "That schedule is not valid.") : (ERRORS[body?.error ?? ""] ?? `Could not save (${res.status})`));
        return;
      }
      onSaved();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{job.name} schedule</DialogTitle>
          <DialogDescription>
            Default: {job.defaultCron} · {zoneName(job.defaultTimeZone)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.cron}
                type="button"
                size="sm"
                variant={cron === preset.cron ? "secondary" : "outline"}
                disabled={busy}
                onClick={() => setCron(preset.cron)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <div className="space-y-1.5">
              <label htmlFor="schedule-cron" className="text-sm font-medium">
                Cron
              </label>
              <Input
                id="schedule-cron"
                value={cron}
                disabled={busy}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setCron(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="schedule-zone" className="text-sm font-medium">
                Time zone
              </label>
              <select id="schedule-zone" value={timeZone} disabled={busy} onChange={(e) => setTimeZone(e.target.value)} className={SELECT}>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zoneName(zone)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg border px-4 py-3 text-sm">
            {problem ? (
              <p className="text-destructive">{problem}</p>
            ) : (
              <>
                <p className="font-medium">{describeCron(cron, timeZone) ?? "Custom schedule"}</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {upcoming.map((at) => (
                    <li key={at.toISOString()}>{when.format(at)}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className={cn(job.custom && "sm:justify-between")}>
          {job.custom && (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(null)}>
              Reset to default
            </Button>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || problem !== null}
              onClick={() => void save(isDefault ? null : { cron, timeZone })}
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

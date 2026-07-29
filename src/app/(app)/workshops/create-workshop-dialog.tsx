"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CLOUDS, CLOUD_LABELS, MAX_USERS, type Cloud } from "@/db/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Format a Date as the value a datetime-local input expects (local time). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function CreateWorkshopDialog({
  open,
  onOpenChange,
  initialDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate: Date | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [userCount, setUserCount] = useState("10");
  const [clouds, setClouds] = useState<Cloud[]>([]);
  const [start, setStart] = useState("");
  const [pending, setPending] = useState<"now" | "schedule" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog opens, defaulting the start time.
  useEffect(() => {
    if (!open) return;
    const base = initialDate ?? new Date();
    if (!initialDate) base.setHours(base.getHours() + 1, 0, 0, 0);
    else base.setHours(9, 0, 0, 0);
    setStart(toLocalInput(base));
    setName("");
    setUserCount("10");
    setClouds([]);
    setError(null);
  }, [open, initialDate]);

  function toggleCloud(cloud: Cloud) {
    setClouds((prev) =>
      prev.includes(cloud) ? prev.filter((c) => c !== cloud) : [...prev, cloud],
    );
  }

  async function createRun(startNow: boolean) {
    if (name.trim().length === 0) {
      setError("Give the workshop a name.");
      return;
    }
    const count = Number(userCount);
    if (!Number.isInteger(count) || count < 1 || count > MAX_USERS) {
      setError(`Enter a number of users between 1 and ${MAX_USERS}.`);
      return;
    }
    if (clouds.length === 0) {
      setError("Pick at least one cloud.");
      return;
    }

    setPending(startNow ? "now" : "schedule");
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          userCount: count,
          clouds,
          ...(startNow
            ? { startNow: true }
            : { scheduledStart: new Date(start).toISOString() }),
        }),
      });
      if (!res.ok) throw new Error(`Could not create workshop (${res.status})`);
      const { run } = await res.json();
      onOpenChange(false);
      // Jump straight to the run so the build streams in view.
      if (startNow) router.push(`/runs/${run.id}`);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create workshop");
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule a workshop</DialogTitle>
          <DialogDescription>
            Attendee accounts and cloud environments are created automatically
            when the start time arrives.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createRun(false);
          }}
          className="grid gap-4"
        >
          <div className="grid gap-1.5">
            <label htmlFor="ws-name" className="text-sm font-medium">
              Workshop name
            </label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Team onboarding — East"
              required
              autoFocus
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="ws-users" className="text-sm font-medium">
              How many users?
            </label>
            <Input
              id="ws-users"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_USERS}
              step={1}
              value={userCount}
              onChange={(e) => setUserCount(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              1–{MAX_USERS} accounts are created in a dedicated organizational
              unit named after the workshop.
            </p>
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">Clouds needed</legend>
            <div className="grid gap-2 pt-1">
              {CLOUDS.map((cloud) => (
                <label
                  key={cloud}
                  htmlFor={`ws-cloud-${cloud}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    id={`ws-cloud-${cloud}`}
                    type="checkbox"
                    checked={clouds.includes(cloud)}
                    onChange={() => toggleCloud(cloud)}
                    className="size-4 rounded border-input accent-primary"
                  />
                  {CLOUD_LABELS[cloud]}
                  {cloud !== "gcp" && (
                    <span className="text-xs text-muted-foreground">
                      (not yet provisioned)
                    </span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-1.5">
            <Button
              type="button"
              variant="secondary"
              disabled={pending !== null}
              onClick={() => createRun(true)}
            >
              {pending === "now" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Zap />
              )}
              {pending === "now" ? "Starting…" : "Start now"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Creates the workshop immediately, ignoring the start time below.
            </p>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="ws-start" className="text-sm font-medium">
              Start date &amp; time
            </label>
            <Input
              id="ws-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending !== null}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending !== null}>
              {pending === "schedule" && <Loader2 className="animate-spin" />}
              {pending === "schedule" ? "Scheduling…" : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

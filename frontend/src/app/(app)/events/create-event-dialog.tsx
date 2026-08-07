"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CLOUDS, CLOUD_LABELS, DEFAULT_TTL_DAYS, MAX_TTL_DAYS, limitsFor, type Cloud, type EventMode } from "@/db/schema";
import { SPRING_SNAPPY, riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Check, Loader2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The start time the form opens on: 9am on a day picked from the calendar,
 * otherwise the top of the next hour. Either way the minutes are zeroed, so
 * the exact moment this is called does not show up in the value.
 */
function defaultStart(initialDate: Date | null): Date {
  // Copied, not adjusted in place: `initialDate` is the caller's state, and
  // this runs during render.
  const base = initialDate ? new Date(initialDate) : new Date();
  if (initialDate) base.setHours(9, 0, 0, 0);
  else base.setHours(base.getHours() + 1, 0, 0, 0);
  return base;
}

/** Format a Date as the value a datetime-local input expects (local time). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const COPY: Record<EventMode, { title: string; description: string; noun: string; who: string }> = {
  workshop: {
    title: "Schedule a workshop",
    description: "Attendee accounts and one shared cloud environment are created automatically when the start time arrives.",
    noun: "workshop",
    who: "attendee",
  },
  challenge: {
    title: "Start a challenge",
    description:
      "Each competitor gets their own account and their own cloud environment, created automatically when the start time arrives.",
    noun: "challenge",
    who: "competitor",
  },
};

export function CreateEventDialog({
  open,
  onOpenChange,
  initialDate,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate: Date | null;
  mode: EventMode;
}) {
  const copy = COPY[mode];
  const limits = limitsFor(mode);
  // A challenge takes exactly one cloud, so the picker behaves as radios.
  const singleCloud = limits.maxClouds === 1;

  const router = useRouter();
  const [name, setName] = useState("");
  const [userCount, setUserCount] = useState(String(limits.defaultUsers));
  const [ttlDays, setTtlDays] = useState(String(DEFAULT_TTL_DAYS));
  const [clouds, setClouds] = useState<Cloud[]>([]);
  const [start, setStart] = useState("");
  const [pending, setPending] = useState<"now" | "schedule" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset the form on the closed -> open transition, so each event is composed
  // from scratch rather than inheriting whatever the last one was left on.
  //
  // Done during render rather than in an effect: an effect runs after the paint,
  // which flashes the previous event's name and clouds for a frame as the dialog
  // animates in. The dialog stays mounted while closed — that is what drives its
  // exit animation — so a `key` remount is not available to do this instead.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStart(toLocalInput(defaultStart(initialDate)));
      setName("");
      setUserCount(String(limits.defaultUsers));
      setTtlDays(String(DEFAULT_TTL_DAYS));
      setClouds([]);
      setError(null);
    }
  }

  function toggleCloud(cloud: Cloud) {
    // Picking a cloud in single-cloud mode replaces the selection rather than
    // adding to it, so the state can never hold a combination the API rejects.
    if (singleCloud) {
      setClouds([cloud]);
      return;
    }
    setClouds((prev) => (prev.includes(cloud) ? prev.filter((c) => c !== cloud) : [...prev, cloud]));
  }

  async function createRun(startNow: boolean) {
    if (name.trim().length === 0) {
      setError(`Give the ${copy.noun} a name.`);
      return;
    }
    const count = Number(userCount);
    if (!Number.isInteger(count) || count < 1 || count > limits.maxUsers) {
      setError(`Enter a number of users between 1 and ${limits.maxUsers}.`);
      return;
    }
    const days = Number(ttlDays);
    if (!Number.isInteger(days) || days < 1 || days > MAX_TTL_DAYS) {
      setError(`Enter a number of days between 1 and ${MAX_TTL_DAYS}.`);
      return;
    }
    if (clouds.length < limits.minClouds) {
      setError(singleCloud ? "Pick a cloud." : "Pick at least one cloud.");
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
          mode,
          userCount: count,
          ttlDays: days,
          clouds,
          ...(startNow ? { startNow: true } : { scheduledStart: new Date(start).toISOString() }),
        }),
      });
      if (!res.ok) throw new Error(`Could not create ${copy.noun} (${res.status})`);
      const { run } = await res.json();
      onOpenChange(false);
      // Jump straight to the run so the build streams in view.
      if (startNow) router.push(`/runs/${run.id}`);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not create ${copy.noun}`);
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription className="leading-relaxed">{copy.description}</DialogDescription>
        </DialogHeader>

        <motion.form
          // Fields arrive just behind the panel, which makes the dialog read as
          // one movement instead of a box that pops and then fills in.
          variants={staggerParent(0.04, 0.08)}
          initial="hidden"
          animate="show"
          onSubmit={(e) => {
            e.preventDefault();
            void createRun(false);
          }}
          className="grid gap-5"
        >
          <motion.div variants={riseChild} className="grid gap-1.5">
            <label htmlFor="ws-name" className="text-sm font-medium">
              {mode === "challenge" ? "Challenge name" : "Workshop name"}
            </label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="platform team workshop"
              required
              autoFocus
            />
          </motion.div>

          <motion.div variants={riseChild} className="grid gap-1.5">
            <label htmlFor="ws-users" className="text-sm font-medium">
              How many {copy.who}s?
            </label>
            <Input
              id="ws-users"
              type="number"
              inputMode="numeric"
              min={1}
              max={limits.maxUsers}
              step={1}
              value={userCount}
              onChange={(e) => setUserCount(e.target.value)}
              required
              className="tnum"
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              1–{limits.maxUsers} accounts are created in a dedicated organizational unit named after the {copy.noun}.
              {mode === "challenge" && " On Google Cloud, each competitor also gets their own project."}
            </p>
          </motion.div>

          <motion.fieldset variants={riseChild} className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{singleCloud ? "Cloud" : "Clouds needed"}</legend>
            {/*
             * Selectable cards rather than bare checkboxes: the whole row is a
             * target and the selected state is legible at a glance.
             */}
            <div className="grid gap-2">
              {CLOUDS.map((cloud) => {
                const selected = clouds.includes(cloud);
                return (
                  <motion.button
                    key={cloud}
                    type="button"
                    role={singleCloud ? "radio" : "checkbox"}
                    aria-checked={selected}
                    onClick={() => toggleCloud(cloud)}
                    whileTap={{ scale: 0.99 }}
                    transition={SPRING_SNAPPY}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      selected ? "border-brand-border bg-brand/8" : "hover:border-brand-border/60 hover:bg-accent/40",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4.5 shrink-0 items-center justify-center border transition-colors",
                        singleCloud ? "rounded-full" : "rounded-[5px]",
                        selected ? "border-brand bg-brand text-brand-foreground" : "border-input",
                      )}
                    >
                      {selected && (
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING_SNAPPY}>
                          <Check className="size-3" strokeWidth={3} />
                        </motion.span>
                      )}
                    </span>
                    <span className="font-medium">{CLOUD_LABELS[cloud]}</span>
                  </motion.button>
                );
              })}
            </div>
            {singleCloud ? (
              <p className="text-xs text-muted-foreground">A challenge runs on a single cloud.</p>
            ) : (
              limits.minClouds === 0 && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {clouds.length === 0
                    ? "No cloud selected — attendees will share the long-lived testing project. Nothing is provisioned or torn down for them."
                    : "Leave all unselected to grant attendees the shared testing project instead of a fresh one."}
                </p>
              )
            )}
          </motion.fieldset>

          <motion.div variants={riseChild} className="grid gap-1.5">
            <label htmlFor="ws-days" className="text-sm font-medium">
              How many days should it run?
            </label>
            <Input
              id="ws-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_TTL_DAYS}
              step={1}
              value={ttlDays}
              onChange={(e) => setTtlDays(e.target.value)}
              required
              className="tnum"
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              The {copy.noun} and everything it provisions are torn down automatically after this many days (1–{MAX_TTL_DAYS}).
              You can add a day later from the {copy.noun}&rsquo;s page.
            </p>
          </motion.div>

          {/* Separated from Schedule: this one ignores the date below. */}
          <motion.div variants={riseChild} className="grid gap-1.5 rounded-lg border border-dashed p-3">
            <Button type="button" variant="secondary" disabled={pending !== null} onClick={() => createRun(true)}>
              {pending === "now" ? <Loader2 className="animate-spin" /> : <Zap />}
              {pending === "now" ? "Starting…" : "Start now"}
            </Button>
            <p className="text-xs text-muted-foreground">Builds the {copy.noun} immediately, ignoring the start time below.</p>
          </motion.div>

          <motion.div variants={riseChild} className="grid gap-1.5">
            <label htmlFor="ws-start" className="text-sm font-medium">
              Start date &amp; time
            </label>
            <Input
              id="ws-start"
              type="datetime-local"
              className="datetime-field border-0 shadow-none pr-1"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </motion.div>

          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-destructive">
              {error}
            </motion.p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending !== null} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={pending !== null}>
              {pending === "schedule" && <Loader2 className="animate-spin" />}
              {pending === "schedule" ? "Scheduling…" : "Schedule"}
            </Button>
          </DialogFooter>
        </motion.form>
      </DialogContent>
    </Dialog>
  );
}

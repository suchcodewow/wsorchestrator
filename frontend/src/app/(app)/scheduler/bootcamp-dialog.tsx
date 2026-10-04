"use client";

/**
 * The form that schedules a bootcamp, or changes one already scheduled, with
 * its guest judges. The judges are saved with the bootcamp, so Cancel leaves
 * them as they were. Making it active while another is asks first, and on yes
 * marks that other one complete in the same save.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import { EmployeePicker } from "@/components/employee-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BOOTCAMP_DEFAULTS, BOOTCAMP_LIMITS, BOOTCAMP_STATUSES, type BootcampStatus } from "@/db/schema";
import { SPRING_SNAPPY, riseChild, staggerParent } from "@/lib/motion";
import type { ActiveBootcamp, BootcampRow } from "@/lib/scheduler/bootcamps";
import type { JudgePick } from "@/lib/scheduler/judges";
import { cn } from "@/lib/utils";
import { formatDate } from "../cohort-settings/format";

export const STATUS_LABELS: Record<BootcampStatus, string> = {
  scheduled: "Scheduled",
  active: "Active",
  complete: "Complete",
};

export const STATUS_BADGES: Record<BootcampStatus, "default" | "secondary" | "outline"> = {
  scheduled: "secondary",
  active: "default",
  complete: "outline",
};

const ERRORS: Record<string, string> = {
  invalid: "Check the start date, the number of days and the judges.",
  not_found: "That bootcamp was removed — reload the page.",
  active_exists: "Another bootcamp is active now — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

function validDays(text: string): number | null {
  const n = Number(text);
  return Number.isInteger(n) && n >= BOOTCAMP_LIMITS.minDays && n <= BOOTCAMP_LIMITS.maxDays ? n : null;
}

export function BootcampDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bootcamp to change; null to schedule a new one. */
  editing: BootcampRow | null;
}) {
  const router = useRouter();
  const [startDate, setStartDate] = useState("");
  const [btcDays, setBtcDays] = useState(String(BOOTCAMP_DEFAULTS.btcDays));
  const [includeInt, setIncludeInt] = useState(true);
  const [intDays, setIntDays] = useState(String(BOOTCAMP_DEFAULTS.intDays));
  const [status, setStatus] = useState<BootcampStatus>("scheduled");
  /** Null while an edited bootcamp's judges load, or if they could not be. */
  const [judges, setJudges] = useState<JudgePick[] | null>([]);
  const [judgesError, setJudgesError] = useState<string | null>(null);
  /** The bootcamp active now, while asking whether to complete it. */
  const [confirming, setConfirming] = useState<ActiveBootcamp | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStartDate(editing?.startDate ?? "");
      setBtcDays(String(editing?.btcDays ?? BOOTCAMP_DEFAULTS.btcDays));
      setIncludeInt(editing ? editing.intDays !== null : true);
      setIntDays(String(editing?.intDays ?? BOOTCAMP_DEFAULTS.intDays));
      setStatus(editing?.status ?? "scheduled");
      setJudges(editing ? null : []);
      setJudgesError(null);
      setConfirming(null);
      setError(null);
    }
  }

  const editingId = editing?.id;
  useEffect(() => {
    if (!open || !editingId) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/scheduler/bootcamps/${editingId}`, { signal: ctrl.signal });
        const body = res.ok ? await res.json() : null;
        if (body) setJudges(body.judges as JudgePick[]);
        else setJudgesError(`Could not load its judges (${res.status}); saving leaves them as they are.`);
      } catch {
        if (!ctrl.signal.aborted) setJudgesError("Could not load its judges; saving leaves them as they are.");
      }
    })();
    return () => ctrl.abort();
  }, [open, editingId]);

  async function addJudge(email: string, fullName?: string) {
    if (!judges) return false;
    if (judges.some((j) => j.email === email.toLowerCase())) {
      setError("That person is already a judge at this bootcamp.");
      return false;
    }
    setError(null);
    setJudges([...judges, { email: email.toLowerCase(), fullName: fullName ?? "" }]);
    return true;
  }

  /** Saves the form; `completeActive` is the active bootcamp the user agreed to complete. */
  async function save(completeActive?: string) {
    const btc = validDays(btcDays);
    const int = includeInt ? validDays(intDays) : null;
    const range = `${BOOTCAMP_LIMITS.minDays} and ${BOOTCAMP_LIMITS.maxDays}`;
    if (!startDate) return setError("Pick a start date.");
    if (btc === null) return setError(`Enter a number of bootcamp days between ${range}.`);
    if (includeInt && int === null) return setError(`Enter a number of intermediate days between ${range}.`);

    setPending(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/scheduler/bootcamps/${editing.id}` : "/api/scheduler/bootcamps", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          btcDays: btc,
          intDays: int,
          status,
          ...(judges && { judges: judges.map((j) => j.email) }),
          ...(completeActive && { completeActive }),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (body?.error === "active_exists" && body.active) {
          setConfirming(body.active as ActiveBootcamp);
          return;
        }
        setConfirming(null);
        setError(
          body?.error === "not_employee"
            ? `${body.email ?? "One of the judges"} is not in the employee list. Remove them and pick from the list.`
            : (ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`),
        );
        return;
      }
      setConfirming(null);
      onOpenChange(false);
      router.refresh();
    } catch {
      setConfirming(null);
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Bootcamp starting ${formatDate(editing.startDate)}` : "Schedule Next Bootcamp"}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            The active bootcamp&apos;s start date is the BTC and INT date its final scores are loaded with.
          </DialogDescription>
        </DialogHeader>

        <motion.form
          variants={staggerParent(0.04, 0.08)}
          initial="hidden"
          animate="show"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="grid gap-5"
        >
          <motion.div variants={riseChild} className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-1.5">
              <label htmlFor="bc-start" className="text-sm font-medium">
                Bootcamp start date
              </label>
              <Input
                id="bc-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="bc-days" className="text-sm font-medium">
                Number of days
              </label>
              <Input
                id="bc-days"
                type="number"
                inputMode="numeric"
                min={BOOTCAMP_LIMITS.minDays}
                max={BOOTCAMP_LIMITS.maxDays}
                step={1}
                value={btcDays}
                onChange={(e) => setBtcDays(e.target.value)}
                required
                className="tnum w-28"
              />
            </div>
          </motion.div>

          <motion.div variants={riseChild} className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <motion.button
              type="button"
              role="checkbox"
              aria-checked={includeInt}
              onClick={() => setIncludeInt((v) => !v)}
              whileTap={{ scale: 0.99 }}
              transition={SPRING_SNAPPY}
              className={cn(
                "flex h-9 cursor-pointer items-center gap-3 rounded-lg border px-3 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                includeInt ? "border-brand-border bg-brand/8" : "hover:border-brand-border/60 hover:bg-accent/40",
              )}
            >
              <span
                className={cn(
                  "flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                  includeInt ? "border-brand bg-brand text-brand-foreground" : "border-input",
                )}
              >
                {includeInt && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING_SNAPPY}>
                    <Check className="size-3" strokeWidth={3} />
                  </motion.span>
                )}
              </span>
              <span className="font-medium">Include Intermediate</span>
            </motion.button>
            <div className="grid gap-1.5">
              <label htmlFor="int-days" className={cn("text-sm font-medium", !includeInt && "text-muted-foreground")}>
                Number of days
              </label>
              <Input
                id="int-days"
                type="number"
                inputMode="numeric"
                min={BOOTCAMP_LIMITS.minDays}
                max={BOOTCAMP_LIMITS.maxDays}
                step={1}
                value={intDays}
                onChange={(e) => setIntDays(e.target.value)}
                disabled={!includeInt}
                required={includeInt}
                className="tnum w-28"
              />
            </div>
          </motion.div>

          <motion.div variants={riseChild} className="grid gap-1.5">
            <span id="bc-status" className="text-sm font-medium">
              Status
            </span>
            <div role="radiogroup" aria-labelledby="bc-status" className="flex w-fit overflow-hidden rounded-md border">
              {BOOTCAMP_STATUSES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={status === value}
                  className={cn(
                    "px-4 py-1.5 text-sm transition-colors",
                    status === value
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                  onClick={() => setStatus(value)}
                >
                  {STATUS_LABELS[value]}
                </button>
              ))}
            </div>
          </motion.div>

          <motion.div variants={riseChild} className="grid gap-2">
            <EmployeePicker
              id="bc-judge"
              label="Guest judges"
              placeholder="Search employees by name"
              busy={judges === null || judges.length >= BOOTCAMP_LIMITS.judges}
              onAdd={addJudge}
            />
            {judgesError ? (
              <p className="text-sm text-destructive">{judgesError}</p>
            ) : judges === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Loading judges…
              </p>
            ) : judges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guest judges.</p>
            ) : (
              <ul className="max-h-48 divide-y overflow-y-auto rounded-lg border">
                {judges.map((j) => (
                  <li key={j.email} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{j.fullName || j.email}</div>
                      {j.fullName && <div className="truncate text-xs text-muted-foreground">{j.email}</div>}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${j.fullName || j.email}`}
                      className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setJudges(judges.filter((other) => other.email !== j.email))}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>

          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="text-sm text-destructive">
              {error}
            </motion.p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={pending || (judges === null && !judgesError)}>
              {pending && !confirming && <Loader2 className="animate-spin" />}
              {editing ? "Save" : "Schedule"}
            </Button>
          </DialogFooter>
        </motion.form>

        <Dialog open={confirming !== null} onOpenChange={(next) => !next && !pending && setConfirming(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Bootcamp starting {confirming ? formatDate(confirming.startDate) : ""} is active
              </DialogTitle>
              <DialogDescription className="leading-relaxed">
                Only one bootcamp can be active. Mark that one complete and make this one active?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button type="button" variant="brand" disabled={pending} onClick={() => confirming && save(confirming.id)}>
                {pending && <Loader2 className="animate-spin" />}
                Complete it and make this one active
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

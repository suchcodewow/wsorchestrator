"use client";

/** The form that schedules a bootcamp, or changes one already scheduled. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BOOTCAMP_DEFAULTS, BOOTCAMP_LIMITS, BOOTCAMP_STATUSES, type BootcampStatus } from "@/db/schema";
import { SPRING_SNAPPY, riseChild, staggerParent } from "@/lib/motion";
import type { BootcampRow } from "@/lib/scheduler/bootcamps";
import { cn } from "@/lib/utils";
import { formatDate } from "../cohort-settings/format";

export const STATUS_LABELS: Record<BootcampStatus, string> = { scheduled: "Scheduled", active: "Active" };

const ERRORS: Record<string, string> = {
  invalid: "Check the start date and the number of days.",
  not_found: "That bootcamp was removed — reload the page.",
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
      setError(null);
    }
  }

  async function save() {
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
        body: JSON.stringify({ startDate, btcDays: btc, intDays: int, status }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          body?.error === "active_exists"
            ? `Only one bootcamp can be active, and ${
                body.active ? `the one starting ${formatDate(body.active.startDate)}` : "another"
              } already is. Make that one scheduled first.`
            : (ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`),
        );
        return;
      }
      onOpenChange(false);
      router.refresh();
    } catch {
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

          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="text-sm text-destructive">
              {error}
            </motion.p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {editing ? "Save" : "Schedule"}
            </Button>
          </DialogFooter>
        </motion.form>
      </DialogContent>
    </Dialog>
  );
}

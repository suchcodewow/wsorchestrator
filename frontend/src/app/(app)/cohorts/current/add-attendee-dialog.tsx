"use client";

/**
 * Adds someone from the employee list to the current cohort by hand: a
 * one-off attendee its rules leave out. They go to Bootcamp or Intermediate
 * on the Sales or Engineer track; the server refuses anyone who has already
 * attended that class, anyone sent to Intermediate without Bootcamp, and
 * anyone already in the cohort.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { EmployeeMatches, useEmployeeSearch, type EmployeeCandidate } from "@/components/employee-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CohortAdditionTrack } from "@/db/schema";
import type { CandidateStage } from "@/lib/evals/current-cohort";
import { cn } from "@/lib/utils";

const STAGES: { stage: CandidateStage; label: string }[] = [
  { stage: "bootcamp", label: "Bootcamp" },
  { stage: "intermediate", label: "Intermediate" },
];

const TRACKS: { track: CohortAdditionTrack; label: string }[] = [
  { track: "sales", label: "Sales" },
  { track: "engineer", label: "Engineer" },
];

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Why the server refused, in words, naming the person and, for a class they attended, when. */
function refusal(error: string, who: string, stage: CandidateStage, date: string | null): string {
  const program = stage === "bootcamp" ? "Bootcamp" : "Intermediate";
  switch (error) {
    case "already_attended":
      return `${who} has already attended ${program}${date ? ` (${DAY.format(new Date(`${date}T00:00:00Z`))})` : ""}, so can't be added to it again.`;
    case "no_bootcamp":
      return `${who} hasn't attended Bootcamp yet, so can't be added to Intermediate. Add them to Bootcamp instead.`;
    case "already_in_cohort":
      return `${who} is already in the current cohort, so there's nothing to add.`;
    case "not_an_employee":
      return `${who} isn't in the employee list from HiBob.`;
    case "forbidden":
      return "Your own role changed — reload the page.";
    default:
      return "That didn't work. Check the choices and try again.";
  }
}

export function AddAttendeeDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (message: string) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<EmployeeCandidate | null>(null);
  const [focused, setFocused] = useState(false);
  const [stage, setStage] = useState<CandidateStage>("bootcamp");
  const [track, setTrack] = useState<CohortAdditionTrack>("sales");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { matches, clear } = useEmployeeSearch(query.trim(), focused && !picked && query.trim().length > 1);

  const [was, setWas] = useState(open);
  if (open !== was) {
    setWas(open);
    if (open) {
      setQuery("");
      setPicked(null);
      setStage("bootcamp");
      setTrack("sales");
      setError(null);
    }
  }

  async function save() {
    if (!picked) return setError("Find the person in the employee list first.");
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/cohorts/current/attendees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: picked.email, stage, track }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) return setError(refusal(out?.error ?? "", picked.fullName, stage, out?.date ?? null));
      onAdded(`${picked.fullName} was added to ${stage === "bootcamp" ? "Bootcamp" : "Intermediate"} on the ${track === "sales" ? "Sales" : "Engineer"} track.`);
      onClose();
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add attendee</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            void save();
          }}
          className="grid gap-5"
        >
          <div className="space-y-1.5">
            <label htmlFor="attendee-name" className="text-sm font-medium">
              Person
            </label>
            <div className="relative">
              <Input
                id="attendee-name"
                value={query}
                autoComplete="off"
                autoFocus
                maxLength={200}
                placeholder="Search the employee list by name"
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onChange={(ev) => {
                  setQuery(ev.target.value);
                  setPicked(null);
                }}
              />
              {focused && (
                <EmployeeMatches
                  matches={matches}
                  onChoose={(m) => {
                    setQuery(m.fullName);
                    setPicked(m);
                    clear();
                  }}
                />
              )}
            </div>
            {picked && <p className="text-xs text-muted-foreground">{picked.email}</p>}
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Add them to</legend>
            <div className="flex gap-2">
              {STAGES.map((s) => (
                <Choice key={s.stage} on={stage === s.stage} onPick={() => setStage(s.stage)}>
                  {s.label}
                </Choice>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Track</legend>
            <div className="flex gap-2">
              {TRACKS.map((t) => (
                <Choice key={t.track} on={track === t.track} onPick={() => setTrack(t.track)}>
                  {t.label}
                </Choice>
              ))}
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={pending || !picked}>
              {pending ? <Loader2 className="animate-spin" /> : <UserPlus />}
              Add attendee
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Choice({ on, onPick, children }: { on: boolean; onPick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={cn(
        "inline-flex h-9 cursor-pointer items-center rounded-full border px-4 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        on ? "border-brand-border bg-brand-subtle text-foreground" : "bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

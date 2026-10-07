"use client";

/** Adding a Google meeting, or changing one: its title, when it starts, how long it runs, and whom it invites. */

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GOOGLE_MEETING_LIMITS, MEETING_GROUPS, MEETING_LENGTHS, type MeetingGroup, type MeetingLength } from "@/db/schema";
import { MEETING_GROUP_LABELS, MEETING_LENGTH_LABELS } from "@/lib/evals/google-meetings-plan";
import { riseChild, SPRING_SNAPPY, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type EditableMeeting = {
  id: string;
  title: string;
  startsAt: string;
  durationMinutes: number;
  groups: MeetingGroup[];
};

const ERRORS: Record<string, string> = {
  invalid: "Give the meeting a title, a start and a length.",
  in_past: "That time has already passed.",
  not_found: "That meeting was deleted — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** An instant as the `datetime-local` input writes it, in the browser's time zone. */
function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The top of the next hour, for a new meeting. */
function nextHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export function MeetingDialog({
  open,
  onOpenChange,
  editing,
  groupSizes,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The meeting to change; null to add one. */
  editing: EditableMeeting | null;
  groupSizes: Record<MeetingGroup, number>;
  onSaved: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [length, setLength] = useState<MeetingLength>(30);
  const [groups, setGroups] = useState<MeetingGroup[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each time it opens, start from the meeting being changed, or a blank one.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const minutes = editing?.durationMinutes ?? 30;
      setTitle(editing?.title ?? "");
      setStart(toLocalInput(editing ? new Date(editing.startsAt) : nextHour()));
      setLength((MEETING_LENGTHS as readonly number[]).includes(minutes) ? (minutes as MeetingLength) : 30);
      setGroups(editing?.groups ?? []);
      setError(null);
    }
  }

  async function save() {
    const startsAt = new Date(start);
    if (!title.trim() || Number.isNaN(startsAt.getTime())) {
      setError(ERRORS.invalid!);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/evals/google-meetings/${editing.id}` : "/api/evals/google-meetings", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), startsAt: startsAt.toISOString(), durationMinutes: length, groups }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`);
        return;
      }
      onOpenChange(false);
      onSaved(body?.title ?? title.trim());
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
          <DialogTitle>{editing ? editing.title : "New meeting"}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {editing ? "Sync Now sends the change to everyone invited." : "Nothing is sent until Sync Now."}
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
          <motion.div variants={riseChild} className="grid gap-1.5">
            <label htmlFor="gm-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="gm-title"
              value={title}
              maxLength={GOOGLE_MEETING_LIMITS.title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Bootcamp kickoff"
              required
              autoFocus
            />
          </motion.div>

          <motion.div variants={riseChild} className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-1.5">
              <label htmlFor="gm-start" className="text-sm font-medium">
                Starts
              </label>
              <Input id="gm-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <span id="gm-length" className="text-sm font-medium">
                Length
              </span>
              <div role="radiogroup" aria-labelledby="gm-length" className="flex h-9 w-fit overflow-hidden rounded-md border">
                {MEETING_LENGTHS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={length === value}
                    className={cn(
                      "px-4 text-sm transition-colors",
                      length === value
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                    onClick={() => setLength(value)}
                  >
                    {MEETING_LENGTH_LABELS[value]}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>

          <motion.fieldset variants={riseChild} className="grid gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Invite</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {MEETING_GROUPS.map((group) => {
                const on = groups.includes(group);
                return (
                  <motion.button
                    key={group}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => setGroups((g) => (on ? g.filter((x) => x !== group) : [...g, group]))}
                    whileTap={{ scale: 0.99 }}
                    transition={SPRING_SNAPPY}
                    className={cn(
                      "flex h-9 cursor-pointer items-center gap-3 rounded-lg border px-3 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      on ? "border-brand-border bg-brand/8" : "hover:border-brand-border/60 hover:bg-accent/40",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                        on ? "border-brand bg-brand text-brand-foreground" : "border-input",
                      )}
                    >
                      {on && (
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING_SNAPPY}>
                          <Check className="size-3" strokeWidth={3} />
                        </motion.span>
                      )}
                    </span>
                    <span className="flex-1 font-medium">{MEETING_GROUP_LABELS[group]}</span>
                    <span className="text-xs text-muted-foreground tnum" title={`${groupSizes[group]} on the Cohorts page's Current tab now`}>
                      {groupSizes[group]}
                    </span>
                  </motion.button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Every Assessments Administrator is invited too.</p>
          </motion.fieldset>

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
              {editing ? "Save" : "Add meeting"}
            </Button>
          </DialogFooter>
        </motion.form>
      </DialogContent>
    </Dialog>
  );
}

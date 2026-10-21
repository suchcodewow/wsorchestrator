"use client";

/**
 * Picking a meeting from the Revenue Enablement calendar, or changing one:
 * which of the names on it in the next 60 days, and whom in the cohort it is
 * for, by stage and by track.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MEETING_STAGES, MEETING_TRACKS, type MeetingStage, type MeetingTrack } from "@/db/schema";
import { MEETING_STAGE_LABELS, MEETING_TRACK_LABELS, meetingKey } from "@/lib/evals/meeting-plan";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";

export type EditableMeeting = { id: string; name: string; stage: MeetingStage; track: MeetingTrack };

type CalendarName = { name: string; next: string; occurrences: number };

const ERRORS: Record<string, string> = {
  invalid: "Pick a meeting, a stage and a track.",
  duplicate: "That meeting is picked already. Change the one there instead.",
  not_found: "That meeting was deleted — reload the page.",
  running: "A sync is running. Try again once it finishes.",
  not_connected: "Its invites can't be taken back until a Google account is connected again, under Admin Settings → External Connectors.",
  remote_failed: "Google would not take back its invites.",
  forbidden: "Your own role changed — reload the page.",
};

const CALENDAR_ERRORS: Record<string, string> = {
  not_connected: "No Google account is connected, so the calendar can't be read. A platform administrator connects one under Admin Settings → External Connectors.",
  not_configured: "The app's Google OAuth client is not set up here, so the calendar can't be read.",
  revoked: "Google no longer accepts the connected account's token. A platform administrator connects it again under Admin Settings → External Connectors.",
};

const SELECT =
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Choice<T extends string>({
  id,
  label,
  values,
  labels,
  value,
  onChange,
}: {
  id: string;
  label: string;
  values: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span id={id} className="text-sm font-medium">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex h-9 w-fit overflow-hidden rounded-md border">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            className={cn(
              "px-4 text-sm transition-colors",
              value === v ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            onClick={() => onChange(v)}
          >
            {labels[v]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MeetingDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The meeting to change; null to pick one. */
  editing: EditableMeeting | null;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [stage, setStage] = useState<MeetingStage>("bootcamp");
  const [track, setTrack] = useState<MeetingTrack>("both");
  const [names, setNames] = useState<CalendarName[] | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadNames() {
    setNames(null);
    setCalendarError(null);
    try {
      const res = await fetch("/api/evals/google-meetings/calendar");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const known = CALENDAR_ERRORS[body?.error ?? ""];
        setCalendarError(known ?? `The calendar could not be read (${res.status}): ${body?.detail ?? "no detail"}`);
        setNames([]);
        return;
      }
      setNames(body.names);
    } catch {
      setCalendarError("Could not reach the server.");
      setNames([]);
    }
  }

  // Each time it opens, start from the meeting being changed, or a blank one, and read the calendar afresh.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(editing?.name ?? "");
      setStage(editing?.stage ?? "bootcamp");
      setTrack(editing?.track ?? "both");
      setError(null);
      void loadNames();
    }
  }

  // A meeting picked earlier keeps its name in the list, even once it is off the calendar.
  const options = names ?? [];
  const listed = editing && !options.some((n) => meetingKey(n.name) === meetingKey(editing.name));

  async function save() {
    if (!name) {
      setError(ERRORS.invalid!);
      return;
    }
    if (
      editing &&
      meetingKey(name) !== meetingKey(editing.name) &&
      !window.confirm(`Change it to “${name}”? Everyone the sync invited to “${editing.name}” is taken off its upcoming invites, and told.`)
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/evals/google-meetings/${editing.id}` : "/api/evals/google-meetings", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, stage, track }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const known = ERRORS[body?.error ?? ""];
        setError(known ? `${known}${body?.detail ? ` ${body.detail}` : ""}` : `Could not save (${res.status}).`);
        return;
      }
      onOpenChange(false);
      onSaved(body?.name ?? name);
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
          <DialogTitle>{editing ? editing.name : "Add a meeting"}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {names === null
              ? "Reading the Revenue Enablement calendar…"
              : `${options.length.toLocaleString()} ${options.length === 1 ? "meeting" : "meetings"} on the Revenue Enablement calendar in the next 60 days`}
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
            <label htmlFor="gm-name" className="text-sm font-medium">
              Meeting
            </label>
            <div className="relative">
              <select
                id="gm-name"
                value={name}
                disabled={names === null || pending}
                onChange={(e) => setName(e.target.value)}
                className={SELECT}
                required
              >
                <option value="" disabled>
                  {names === null ? "Loading…" : "Pick a meeting"}
                </option>
                {listed && <option value={editing.name}>{editing.name} (not on the calendar now)</option>}
                {options.map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.name} — next {formatWhen(n.next)}
                    {n.occurrences > 1 ? `, ${n.occurrences} in all` : ""}
                  </option>
                ))}
              </select>
              {names === null && <Loader2 className="pointer-events-none absolute top-2.5 right-8 size-4 animate-spin text-muted-foreground" />}
            </div>
            {calendarError && <p className="text-xs text-destructive">{calendarError}</p>}
          </motion.div>

          <motion.div variants={riseChild} className="grid gap-4">
            <Choice id="gm-stage" label="Stage" values={MEETING_STAGES} labels={MEETING_STAGE_LABELS} value={stage} onChange={setStage} />
            <Choice id="gm-track" label="Track" values={MEETING_TRACKS} labels={MEETING_TRACK_LABELS} value={track} onChange={setTrack} />
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
            <Button type="submit" variant="brand" disabled={pending || !name}>
              {pending && <Loader2 className="animate-spin" />}
              {editing ? "Save" : "Add meeting"}
            </Button>
          </DialogFooter>
        </motion.form>
      </DialogContent>
    </Dialog>
  );
}

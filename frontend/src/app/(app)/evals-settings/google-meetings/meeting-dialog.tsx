"use client";

/**
 * Picking a meeting from the Revenue Enablement calendar, or changing one:
 * which of the names on it in the next 60 days, whom in the cohort it is
 * for, by stage and by track, and whether each is invited to one occurrence
 * or to every one until their class.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MEETING_STAGES, MEETING_TRACKS, type MeetingStage, type MeetingTrack } from "@/db/schema";
import { MEETING_STAGE_LABELS, MEETING_TRACK_LABELS, meetingKey } from "@/lib/evals/meeting-plan";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";
import { TimezoneMap, type TimezoneCoverage } from "./timezone-map";

export type EditableMeeting = {
  id: string;
  name: string;
  stage: MeetingStage;
  track: MeetingTrack;
  timezoneFrom: number | null;
  timezoneTo: number | null;
  minDaysAfterStart: number;
  allOccurrences: boolean;
};

type Count = "one" | "all";
const COUNTS: readonly Count[] = ["one", "all"];

/** Where the range starts when the filter is first ticked: the Americas. */
const DEFAULT_RANGE = { from: -8, to: -5 };

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
  const [minDays, setMinDays] = useState(0);
  const [count, setCount] = useState<Count>("one");
  const [filterZones, setFilterZones] = useState(false);
  const [zoneFrom, setZoneFrom] = useState(DEFAULT_RANGE.from);
  const [zoneTo, setZoneTo] = useState(DEFAULT_RANGE.to);
  const [loaded, setLoaded] = useState<{ stage: MeetingStage; track: MeetingTrack; at: string; coverage: TimezoneCoverage } | null>(null);
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
      setMinDays(editing?.minDaysAfterStart ?? 0);
      setCount(editing?.allOccurrences ? "all" : "one");
      setFilterZones(editing?.timezoneFrom != null && editing?.timezoneTo != null);
      setZoneFrom(editing?.timezoneFrom ?? DEFAULT_RANGE.from);
      setZoneTo(editing?.timezoneTo ?? DEFAULT_RANGE.to);
      setError(null);
      void loadNames();
    }
  }

  const options = names ?? [];
  const next = options.find((n) => meetingKey(n.name) === meetingKey(name))?.next;
  const meetingAt = next && !Number.isNaN(new Date(next).getTime()) ? new Date(next) : null;
  // Daylight saving moves offsets, so the map reads them when the meeting starts.
  const at = meetingAt?.toISOString() ?? "";
  const coverage = loaded?.stage === stage && loaded.track === track && loaded.at === at ? loaded.coverage : null;

  // The map shows who the stage and track cover, so it is read again when either changes.
  useEffect(() => {
    if (!open || !filterZones) return;
    let current = true;
    const done = (coverage: TimezoneCoverage | null) => {
      if (current) setLoaded({ stage, track, at, coverage: coverage ?? { byHour: {}, people: {}, unknown: 0, total: 0 } });
    };
    fetch(`/api/evals/google-meetings/timezones?stage=${stage}&track=${track}${at ? `&at=${encodeURIComponent(at)}` : ""}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(done)
      .catch(() => done(null));
    return () => {
      current = false;
    };
  }, [open, filterZones, stage, track, at]);

  // A meeting picked earlier keeps its name in the list, even once it is off the calendar.
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
        body: JSON.stringify({ name, stage, track, timezoneFrom: filterZones ? zoneFrom : null, timezoneTo: filterZones ? zoneTo : null, minDaysAfterStart: minDays, allOccurrences: count === "all" }),
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
            <Choice
              id="gm-count"
              label="Invite to"
              values={COUNTS}
              labels={{ one: "1 meeting", all: `All meetings until ${MEETING_STAGE_LABELS[stage]}` }}
              value={count}
              onChange={setCount}
            />
            <Choice id="gm-track" label="Track" values={MEETING_TRACKS} labels={MEETING_TRACK_LABELS} value={track} onChange={setTrack} />
          </motion.div>

          <motion.div variants={riseChild} className="grid gap-1.5">
            <label htmlFor="gm-min-days" className="text-sm font-medium">
              Minimum tenure for an attendee before scheduling
            </label>
            <div className="flex items-center gap-2">
              <input
              id="gm-min-days"
              type="number"
              min={0}
              max={365}
              step={1}
              value={minDays}
              disabled={pending}
              onChange={(e) => setMinDays(Math.min(365, Math.max(0, Math.trunc(Number(e.target.value)) || 0)))}
              className={cn(SELECT, "w-28 tabular-nums")}
            />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
            <p className="text-xs text-muted-foreground">Tenure rule is ignored if it would leave someone no meeting to attend before their class.</p>
          </motion.div>

          <motion.div variants={riseChild} className="grid gap-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={filterZones}
                disabled={pending}
                onChange={(e) => setFilterZones(e.target.checked)}
                className="size-3.5 shrink-0 accent-brand"
              />
              Filter by timezones
            </label>
            {filterZones && (
              <TimezoneMap
                coverage={coverage}
                meetingAt={meetingAt}
                from={zoneFrom}
                to={zoneTo}
                disabled={pending}
                onChange={(from, to) => {
                  setZoneFrom(from);
                  setZoneTo(to);
                }}
              />
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

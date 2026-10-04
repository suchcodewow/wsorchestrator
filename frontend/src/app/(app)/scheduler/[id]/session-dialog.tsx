"use client";

/**
 * Adding or changing one session: what it is, who leads it and who else
 * teaches, and which rooms it takes. Anyone or any room already busy at that
 * time is shown in red with what they are busy with, and cannot be added.
 * A viewer sees the same, without the controls.
 */

import { useMemo, useState } from "react";
import { Crown, Loader2, Trash2 } from "lucide-react";
import { SessionLookFields, type SessionLook } from "@/components/session-look-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SCHEDULE_LIMITS, type ScheduleTrack } from "@/db/schema";
import type { RoomRow } from "@/lib/scheduler/facilities";
import type { Instructor, SessionRow, StaffRow } from "@/lib/scheduler/schedule";
import { SESSION_STYLES } from "@/lib/scheduler/session-style";
import type { SessionTypeRow } from "@/lib/scheduler/session-types";
import {
  KIND_LABELS,
  TRACK_LABELS,
  busyDuring,
  dayDate,
  describeClash,
  formatClock,
  formatLength,
  nextStart,
  type Clash,
  type Placed,
} from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";
import { formatDate } from "../../cohort-settings/format";
import { Comments } from "./comments";
import { dayOf, locate, type Days } from "./days";

export type SessionTarget =
  /** `start` is the unscheduled time it was added in; without one it goes after the last session of the day. */
  | { mode: "new"; track: ScheduleTrack; day: number; start?: number }
  | { mode: "edit"; session: SessionRow };

const ERRORS: Record<string, string> = {
  invalid: "Give it a name, and a length in whole quarter hours.",
  not_found: "That session was removed — reload the page.",
  no_day: "That track does not run on that day.",
  day_full: `That day already holds ${SCHEDULE_LIMITS.sessionsPerDay} sessions.`,
  past_midnight: "That would push the day past midnight.",
  no_leader: "Pick one leader.",
  unknown_room: "That room is not at this bootcamp's facility any more — reload the page.",
  shared_room: "Two instructors cannot share a breakout room.",
  unknown_type: "That session type was removed — pick another.",
  forbidden: "Your role changed — reload the page.",
};

const BLANK: SessionLook = { kind: "main", name: "", emoji: "", color: "slate", minutes: 60, description: "" };

const lookOf = (s: SessionLook): SessionLook => ({
  kind: s.kind,
  name: s.name,
  emoji: s.emoji,
  color: s.color,
  minutes: s.minutes,
  description: s.description,
});

export function SessionDialog({
  target,
  onClose,
  bootcampId,
  startDate,
  days,
  placed,
  rooms,
  hasFacility,
  instructors,
  types,
  canManage,
  viewerId,
  flush,
  onChanged,
}: {
  target: SessionTarget | null;
  onClose: () => void;
  bootcampId: string;
  startDate: string;
  days: Days;
  placed: Placed<SessionRow>[];
  rooms: RoomRow[];
  hasFacility: boolean;
  instructors: Instructor[];
  types: SessionTypeRow[];
  canManage: boolean;
  viewerId: string;
  /** Saves any rearranging still waiting, so this save lands on top of it. */
  flush: () => Promise<boolean>;
  onChanged: () => Promise<void>;
}) {
  const existing = target?.mode === "edit" ? target.session : null;
  const [look, setLook] = useState<SessionLook>(BLANK);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<Clash[]>([]);
  const [filter, setFilter] = useState("");
  const [commented, setCommented] = useState(false);

  const [was, setWas] = useState(target);
  if (target !== was) {
    setWas(target);
    if (target) {
      const s = target.mode === "edit" ? target.session : null;
      setLook(s ? lookOf(s) : BLANK);
      setTypeId(s?.typeId ?? null);
      setStaff(s?.staff ?? []);
      setRoomId(s?.roomId ?? null);
      setError(null);
      setClashes([]);
      setFilter("");
      setCommented(false);
    }
  }

  // Where it is, or would go: when new, the time it was added in, or the end of its day.
  const where = useMemo(() => {
    if (!target) return null;
    if (target.mode === "new") {
      const list = days[target.track][target.day - 1] ?? [];
      return { track: target.track, day: target.day, start: target.start ?? nextStart(list) };
    }
    const at = locate(days, target.session.id);
    if (!at) return { track: target.session.track, day: target.session.day, start: target.session.start };
    const s = dayOf(days, at.key)[at.index]!;
    return { track: s.track, day: s.day, start: s.start };
  }, [target, days]);

  const busy = useMemo(
    () =>
      where
        ? busyDuring(placed, { day: where.day, start: where.start, end: where.start + look.minutes, excludeId: existing?.id })
        : { people: new Map<string, Clash[]>(), rooms: new Map<string, Clash[]>() },
    [placed, where, look.minutes, existing?.id],
  );

  const before = useMemo(() => {
    const s = existing;
    return {
      people: new Set(s && s.kind !== "unstructured" ? s.staff.map((p) => p.email) : []),
      rooms: new Set(s ? (s.kind === "main" ? [s.roomId] : s.kind === "breakout" ? s.staff.map((p) => p.roomId) : []) : []),
    };
  }, [existing]);

  if (!target || !where) return <Dialog open={false} />;

  const editable = canManage;
  const leader = staff.find((p) => p.leader);
  const pool = [
    ...instructors,
    // Someone kept on the session who is no longer an instructor of this bootcamp.
    ...staff.filter((p) => !instructors.some((i) => i.email === p.email)).map((p) => ({ email: p.email, fullName: p.fullName, role: "former" as const })),
  ];
  const shownPool = filter.trim()
    ? pool.filter((p) => `${p.fullName} ${p.email}`.toLowerCase().includes(filter.trim().toLowerCase()))
    : pool;

  const toggle = (p: { email: string; fullName: string }) => {
    const on = staff.some((s) => s.email === p.email);
    if (on) {
      const rest = staff.filter((s) => s.email !== p.email);
      setStaff(rest.length > 0 && !rest.some((s) => s.leader) ? rest.map((s, i) => ({ ...s, leader: i === 0 })) : rest);
    } else {
      setStaff([...staff, { email: p.email, fullName: p.fullName, leader: staff.length === 0, roomId: null }]);
    }
  };
  const makeLeader = (email: string) => {
    const next = staff.map((s) => ({ ...s, leader: s.email === email }));
    setStaff([...next.filter((s) => s.leader), ...next.filter((s) => !s.leader)]);
  };
  const setStaffRoom = (email: string, room: string | null) =>
    setStaff(staff.map((s) => (s.email === email ? { ...s, roomId: room } : s)));

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? "A removed room";
  const end = where.start + look.minutes;

  async function save() {
    if (!look.name.trim()) return setError("Give it a name.");
    setPending(true);
    setError(null);
    setClashes([]);
    try {
      await flush();
      const fields = {
        kind: look.kind,
        name: look.name.trim(),
        emoji: look.emoji.trim(),
        color: look.color,
        minutes: look.minutes,
        description: look.description,
        typeId,
        roomId: look.kind === "main" ? roomId : null,
        staff: look.kind === "unstructured" ? [] : staff.map((s) => ({ email: s.email, leader: s.leader, roomId: look.kind === "breakout" ? s.roomId : null })),
      };
      const res = await fetch(
        existing ? `/api/scheduler/bootcamps/${bootcampId}/sessions/${existing.id}` : `/api/scheduler/bootcamps/${bootcampId}/sessions`,
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(existing ? fields : { track: where!.track, day: where!.day, start: where!.start, ...fields }),
        },
      );
      const out = await res.json().catch(() => null);
      if (!res.ok) {
        if (out?.error === "clash") {
          setClashes(out.clashes ?? []);
          return setError("Someone or a room you added is busy then.");
        }
        if (out?.error === "not_instructor") return setError(`${out.email} is not a Training administrator or a guest judge of this bootcamp.`);
        return setError(ERRORS[out?.error ?? ""] ?? `Could not save (${res.status}).`);
      }
      await onChanged();
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!existing || !window.confirm(`Remove ${existing.name}? Its time becomes unscheduled.`)) return;
    setPending(true);
    setError(null);
    try {
      await flush();
      const res = await fetch(`/api/scheduler/bootcamps/${bootcampId}/sessions/${existing.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) return setError(`Could not remove it (${res.status}).`);
      await onChanged();
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  const close = () => {
    if (pending) return;
    if (commented) void onChanged();
    onClose();
  };

  const placeLine = `${TRACK_LABELS[where.track]} · Day ${where.day}, ${formatDate(dayDate(startDate, where.day))} · ${formatClock(where.start)}–${formatClock(end)}`;

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {look.emoji && <span aria-hidden>{look.emoji}</span>}
            {existing ? existing.name : "Add session"}
          </DialogTitle>
          <p className={cn("text-sm tabular-nums", end > SCHEDULE_LIMITS.dayEnd ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
            {placeLine}
            {end > SCHEDULE_LIMITS.dayEnd && ` · ${formatLength(end - SCHEDULE_LIMITS.dayEnd)} past 5 PM`}
          </p>
        </DialogHeader>

        {editable ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="grid gap-6"
          >
            {!existing && types.length > 0 && (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Start from</span>
                <div className="flex flex-wrap gap-1.5">
                  {types.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={typeId === t.id}
                      onClick={() => {
                        setTypeId(t.id);
                        setLook(lookOf(t));
                      }}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border border-l-4 px-2 py-1 text-sm transition-shadow",
                        SESSION_STYLES[t.color].card,
                        typeId === t.id && "ring-2 ring-brand/60",
                      )}
                    >
                      {t.emoji && <span aria-hidden>{t.emoji}</span>}
                      {t.name}
                      <span className="text-xs text-muted-foreground">{formatLength(t.minutes)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <SessionLookFields id="session" value={look} onChange={setLook} autoFocus={!existing} />

            {look.kind !== "unstructured" && (
              <section className="grid gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">
                    Instructors
                    <span className="ml-2 font-normal text-muted-foreground">
                      {staff.length === 0 ? "No leader yet" : `${leader?.fullName ?? "—"} leading${staff.length > 1 ? `, ${staff.length - 1} more` : ""}`}
                    </span>
                  </h3>
                  {pool.length > 8 && (
                    <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find someone" className="h-8 w-48" aria-label="Find an instructor" />
                  )}
                </div>
                {pool.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No Training administrators or guest judges yet.</p>
                ) : (
                  <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                    {shownPool.map((p) => {
                      const on = staff.find((s) => s.email === p.email);
                      const theirs = busy.people.get(p.email) ?? [];
                      const blocked = theirs.length > 0 && !before.people.has(p.email);
                      return (
                        <li key={p.email} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2", theirs.length > 0 && "bg-red-50/70 dark:bg-red-950/20")}>
                          <label className={cn("flex min-w-0 flex-1 items-center gap-2.5", blocked && !on ? "cursor-not-allowed" : "cursor-pointer")}>
                            <input
                              type="checkbox"
                              checked={Boolean(on)}
                              disabled={blocked && !on}
                              onChange={() => toggle(p)}
                              className="size-4 accent-brand"
                            />
                            <span className="min-w-0">
                              <span className={cn("block truncate text-sm", theirs.length > 0 && "font-medium text-red-700 dark:text-red-400")}>
                                {p.fullName}
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                  {p.role === "administrator" ? "Admin" : p.role === "judge" ? "Guest judge" : "No longer an instructor"}
                                </span>
                              </span>
                              {theirs.map((c) => (
                                <span key={c.sessionId} className="block truncate text-xs text-red-700 dark:text-red-400">
                                  Busy: {describeClash(c)}
                                </span>
                              ))}
                            </span>
                          </label>
                          {on && (
                            <div className="flex items-center gap-2">
                              {look.kind === "breakout" && (
                                <RoomSelect
                                  label={`${p.fullName}'s room`}
                                  value={on.roomId}
                                  rooms={rooms}
                                  busy={busy.rooms}
                                  before={before.rooms}
                                  taken={new Set(staff.filter((s) => s.email !== p.email).flatMap((s) => (s.roomId ? [s.roomId] : [])))}
                                  onChange={(r) => setStaffRoom(p.email, r)}
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => makeLeader(p.email)}
                                aria-pressed={on.leader}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                                  on.leader ? "border-amber-400 bg-amber-100 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" : "text-muted-foreground hover:bg-accent",
                                )}
                              >
                                <Crown className="size-3" />
                                {on.leader ? "Leader" : "Make leader"}
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {look.kind === "breakout" && !hasFacility && (
                  <p className="text-xs text-muted-foreground">Pick a facility for this bootcamp on the Scheduler to give each instructor a room.</p>
                )}
              </section>
            )}

            {look.kind === "main" && (
              <section className="grid gap-2">
                <h3 className="text-sm font-medium">
                  Room
                  {roomId && <span className="ml-2 font-normal text-muted-foreground">{roomName(roomId)}</span>}
                </h3>
                {!hasFacility ? (
                  <p className="text-sm text-muted-foreground">Pick a facility for this bootcamp on the Scheduler to give sessions rooms.</p>
                ) : rooms.length === 0 ? (
                  <p className="text-sm text-muted-foreground">This bootcamp&apos;s facility has no rooms yet.</p>
                ) : (
                  <div role="radiogroup" aria-label="Room" className="grid gap-1.5 sm:grid-cols-2">
                    <RoomOption label="No room" detail="" on={roomId === null} onPick={() => setRoomId(null)} />
                    {rooms.map((r) => {
                      const theirs = busy.rooms.get(r.id) ?? [];
                      return (
                        <RoomOption
                          key={r.id}
                          label={r.name}
                          detail={`Holds ${r.capacity}`}
                          on={roomId === r.id}
                          busy={theirs}
                          disabled={theirs.length > 0 && !before.rooms.has(r.id) && roomId !== r.id}
                          onPick={() => setRoomId(r.id)}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {error && (
              <div role="alert" className="text-sm text-destructive">
                <p>{error}</p>
                {clashes.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {clashes.map((c, i) => (
                      <li key={i}>
                        {c.what.kind === "person" ? c.what.fullName : roomName(c.what.roomId)}: {describeClash(c)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <DialogFooter className="sm:justify-between">
              <div>
                {existing && (
                  <Button type="button" variant="ghost" disabled={pending} onClick={remove} className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 />
                    Remove
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" disabled={pending} onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" variant="brand" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" />}
                  {existing ? "Save" : "Add session"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        ) : (
          existing && <ReadOnly session={existing} roomName={roomName} />
        )}

        {existing && (
          <Comments
            key={existing.id}
            bootcampId={bootcampId}
            sessionId={existing.id}
            canWrite={canManage}
            viewerId={viewerId}
            people={instructors}
            onChange={() => setCommented(true)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RoomOption({
  label,
  detail,
  on,
  busy = [],
  disabled,
  onPick,
}: {
  label: string;
  detail: string;
  on: boolean;
  busy?: Clash[];
  disabled?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed",
        on ? "border-brand-border bg-brand/8" : "hover:bg-accent/40",
        busy.length > 0 && "border-red-300 bg-red-50/70 dark:border-red-900/70 dark:bg-red-950/20",
      )}
    >
      <div className={cn("flex items-baseline justify-between gap-2 text-sm", busy.length > 0 && "font-medium text-red-700 dark:text-red-400")}>
        <span className="truncate">{label}</span>
        {detail && <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{detail}</span>}
      </div>
      {busy.map((c) => (
        <div key={c.sessionId} className="truncate text-xs text-red-700 dark:text-red-400">
          Busy: {describeClash(c)}
        </div>
      ))}
    </button>
  );
}

/** A breakout instructor's room. Busy rooms are listed with what they are busy with, and cannot be picked. */
function RoomSelect({
  label,
  value,
  rooms,
  busy,
  before,
  taken,
  onChange,
}: {
  label: string;
  value: string | null;
  rooms: RoomRow[];
  busy: Map<string, Clash[]>;
  before: Set<string | null>;
  taken: Set<string>;
  onChange: (room: string | null) => void;
}) {
  if (rooms.length === 0) return null;
  const mine = value ? (busy.get(value) ?? []) : [];
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        "h-8 max-w-56 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none dark:bg-input/30",
        mine.length > 0 && "border-red-400 text-red-700 dark:text-red-400",
      )}
    >
      <option value="">No room</option>
      {rooms.map((r) => {
        const theirs = busy.get(r.id) ?? [];
        const why = taken.has(r.id) ? "another instructor's" : theirs.length > 0 ? `busy: ${describeClash(theirs[0]!)}` : "";
        return (
          <option key={r.id} value={r.id} disabled={r.id !== value && (taken.has(r.id) || (theirs.length > 0 && !before.has(r.id)))}>
            {r.name}
            {why ? ` (${why})` : ` (holds ${r.capacity})`}
          </option>
        );
      })}
    </select>
  );
}

function ReadOnly({ session: s, roomName }: { session: SessionRow; roomName: (id: string) => string }) {
  const rooms = s.kind === "main" ? (s.roomId ? [roomName(s.roomId)] : []) : s.staff.flatMap((p) => (p.roomId ? [`${p.fullName}: ${roomName(p.roomId)}`] : []));
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
      <dt className="text-muted-foreground">Kind</dt>
      <dd>{KIND_LABELS[s.kind]}</dd>
      <dt className="text-muted-foreground">Length</dt>
      <dd>{formatLength(s.minutes)}</dd>
      {s.kind !== "unstructured" && (
        <>
          <dt className="text-muted-foreground">Instructors</dt>
          <dd>{s.staff.length === 0 ? "No leader yet" : s.staff.map((p) => `${p.fullName}${p.leader ? " (leader)" : ""}`).join(", ")}</dd>
          <dt className="text-muted-foreground">Rooms</dt>
          <dd>{rooms.length === 0 ? "None" : rooms.join(", ")}</dd>
        </>
      )}
      {s.description && (
        <>
          <dt className="text-muted-foreground">Description</dt>
          <dd className="whitespace-pre-wrap">{s.description}</dd>
        </>
      )}
    </dl>
  );
}

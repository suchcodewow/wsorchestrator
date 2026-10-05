"use client";

/**
 * Adding or changing one session: what it is, who it is taught to, who leads
 * it and who else teaches, and which rooms it takes. Anyone or any room
 * already busy at that time is shown in red with what they are busy with, and
 * cannot be added. Attendees taught something else beside it on their class
 * or SE track are shown in red too, but it still saves, as a moved session
 * does. Its comments are on a tab of their own, and a breakout's groups and
 * each instructor's room on a third. A viewer sees the same, without the
 * controls.
 */

import { useMemo, useState, type KeyboardEvent } from "react";
import { Crown, Loader2, Trash2 } from "lucide-react";
import { SessionLookFields, type SessionLook } from "@/components/session-look-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SCHEDULE_LIMITS, SESSION_AUDIENCES, type ScheduleTrack, type SessionAudience } from "@/db/schema";
import type { RoomRow } from "@/lib/scheduler/facilities";
import type { GroupRow } from "@/lib/scheduler/groups";
import type { Instructor, SessionRow, StaffRow } from "@/lib/scheduler/schedule";
import { SESSION_STYLES } from "@/lib/scheduler/session-style";
import type { SessionTypeRow } from "@/lib/scheduler/session-types";
import {
  AUDIENCE_LABELS,
  GROUP_NAMES,
  KIND_LABELS,
  TRACK_LABELS,
  audienceClashes,
  busyDuring,
  dayDate,
  defaultAudience,
  describeClash,
  formatClock,
  formatLength,
  nextStart,
  type Clash,
  type Placed,
} from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";
import { formatDate } from "../../cohort-settings/format";
import { BreakoutGroups, keptGroups } from "./breakout-groups";
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

const GROUP_ERRORS: Record<string, string> = {
  not_breakout: "it is no longer a breakout",
  not_staff: "someone in them is no longer one of its instructors",
  not_attendee: "someone in them is no longer in the class",
  not_found: "the session was removed",
};

type Tab = "session" | "comments" | "groups";
const TAB_LABELS: Record<Tab, string> = { session: "Session", comments: "Comments", groups: "Breakout Assignments" };

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
  const [audience, setAudience] = useState<SessionAudience>("both");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<Clash[]>([]);
  const [filter, setFilter] = useState("");
  const [commented, setCommented] = useState(false);
  const [commentDelta, setCommentDelta] = useState(0);
  const [tab, setTab] = useState<Tab>("session");
  /** The breakout's groups as changed on their tab; null until they are. */
  const [groups, setGroups] = useState<GroupRow[] | null>(null);

  const [was, setWas] = useState(target);
  if (target !== was) {
    setWas(target);
    if (target) {
      const s = target.mode === "edit" ? target.session : null;
      setLook(s ? lookOf(s) : BLANK);
      setTypeId(s?.typeId ?? null);
      setAudience(s?.audience ?? defaultAudience(target.mode === "new" ? target.track : target.session.track));
      setStaff(s?.staff ?? []);
      setRoomId(s?.roomId ?? null);
      setError(null);
      setClashes([]);
      setFilter("");
      setCommented(false);
      setCommentDelta(0);
      setTab("session");
      setGroups(null);
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

  const taughtBeside = useMemo(
    () =>
      where
        ? audienceClashes(placed, { track: where.track, kind: look.kind, audience }, { day: where.day, start: where.start, end: where.start + look.minutes, excludeId: existing?.id })
        : [],
    [placed, where, look.kind, look.minutes, audience, existing?.id],
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
  const setStaffRooms = (picks: Record<string, string | null>) =>
    setStaff((now) => now.map((s) => (s.email in picks ? { ...s, roomId: picks[s.email]! } : s)));

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? "A removed room";
  const end = where.start + look.minutes;

  const tabs: Tab[] = ["session", ...(existing ? (["comments"] as const) : []), ...(look.kind === "breakout" ? (["groups"] as const) : [])];
  const shown: Tab = tabs.includes(tab) ? tab : "session";
  const onTabKey = (e: KeyboardEvent) => {
    const by = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    const next = tabs[(tabs.indexOf(shown) + by + tabs.length) % tabs.length]!;
    setTab(next);
    document.getElementById(`session-tab-${next}`)?.focus();
  };

  async function save() {
    if (!look.name.trim()) {
      setTab("session");
      return setError("Give it a name.");
    }
    setPending(true);
    setError(null);
    setClashes([]);
    try {
      await flush();
      const fields = {
        kind: look.kind,
        audience,
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
      const grouped = look.kind === "breakout" && groups ? await saveGroups(out.id, groups) : null;
      await onChanged();
      if (grouped) {
        // A new session is added either way; saving again would add it twice.
        if (!existing) window.alert(`${look.name.trim()} was added, but not its groups: ${grouped}. Open it to assign them again.`);
        else return setError(`Saved the session, but not its groups: ${grouped}.`);
      }
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  /** Replaces the breakout's groups, leaving out any it can no longer keep; an error to show, or null. */
  async function saveGroups(sessionId: string, rows: GroupRow[]): Promise<string | null> {
    const res = await fetch(`/api/scheduler/bootcamps/${bootcampId}/sessions/${sessionId}/groups`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups: keptGroups(rows, staff, audience).map((g) => ({ email: g.email, instructorEmail: g.instructorEmail })) }),
    });
    if (res.ok) {
      setGroups(null);
      return null;
    }
    const out = await res.json().catch(() => null);
    return GROUP_ERRORS[out?.error ?? ""] ?? `the server said ${res.status}`;
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

        {tabs.length > 1 && (
          <div role="tablist" aria-label="Session" onKeyDown={onTabKey} className="-mt-1 flex gap-1 border-b">
            {tabs.map((t) => (
              <button
                key={t}
                id={`session-tab-${t}`}
                type="button"
                role="tab"
                aria-selected={shown === t}
                aria-controls={t === "session" && editable ? "session-form" : `session-panel-${t}`}
                tabIndex={shown === t ? 0 : -1}
                onClick={() => setTab(t)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  shown === t ? "border-brand font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {TAB_LABELS[t]}
                {t === "comments" && existing && (
                  <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{Math.max(0, existing.comments + commentDelta)}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {editable ? (
          <form
            id="session-form"
            role="tabpanel"
            aria-labelledby="session-tab-session"
            hidden={shown !== "session"}
            noValidate
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
              <section className="grid gap-1.5">
                <span id="session-audience" className="text-sm font-medium">
                  Taught to
                </span>
                <div role="radiogroup" aria-labelledby="session-audience" className="inline-flex w-fit rounded-lg border p-0.5">
                  {SESSION_AUDIENCES.map((a) => (
                    <button
                      key={a}
                      type="button"
                      role="radio"
                      aria-checked={audience === a}
                      onClick={() => setAudience(a)}
                      className={cn(
                        "rounded-md px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        audience === a ? "bg-brand/10 font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {AUDIENCE_LABELS[a]}
                    </button>
                  ))}
                </div>
                {taughtBeside.map((c, i) => (
                  <p key={i} className="text-xs text-red-700 dark:text-red-400">
                    {c.what.kind === "audience" && GROUP_NAMES[c.what.group]} are also in {describeClash(c)}
                  </p>
                ))}
              </section>
            )}

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
          </form>
        ) : (
          existing && (
            <div role="tabpanel" id="session-panel-session" aria-labelledby="session-tab-session" hidden={shown !== "session"}>
              <ReadOnly session={existing} roomName={roomName} />
            </div>
          )
        )}

        {existing && (
          <div role="tabpanel" id="session-panel-comments" aria-labelledby="session-tab-comments" hidden={shown !== "comments"}>
            <Comments
              key={existing.id}
              bootcampId={bootcampId}
              sessionId={existing.id}
              canWrite={canManage}
              viewerId={viewerId}
              people={instructors}
              onChange={(delta) => {
                setCommented(true);
                setCommentDelta((d) => d + delta);
              }}
            />
          </div>
        )}

        {look.kind === "breakout" && (
          <div role="tabpanel" id="session-panel-groups" aria-labelledby="session-tab-groups" hidden={shown !== "groups"}>
            <BreakoutGroups
              key={existing?.id ?? "new"}
              bootcampId={bootcampId}
              sessionId={existing?.id ?? null}
              track={where.track}
              audience={audience}
              staff={staff}
              rooms={rooms}
              busyRooms={busy.rooms}
              beforeRooms={before.rooms}
              hasFacility={hasFacility}
              roomName={roomName}
              value={groups}
              onChange={setGroups}
              onRooms={setStaffRooms}
              editable={editable}
            />
          </div>
        )}

        {editable && (
          <>
            {error && (
              <div role="alert" className="text-sm text-destructive">
                <p>{error}</p>
                {clashes.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {clashes.map((c, i) => (
                      <li key={i}>
                        {c.what.kind === "person" ? c.what.fullName : c.what.kind === "room" ? roomName(c.what.roomId) : GROUP_NAMES[c.what.group]}: {describeClash(c)}
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
                <Button type="submit" form="session-form" variant="brand" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" />}
                  {existing ? "Save" : "Add session"}
                </Button>
              </div>
            </DialogFooter>
          </>
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
          <dt className="text-muted-foreground">Taught to</dt>
          <dd>{AUDIENCE_LABELS[s.audience]}</dd>
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

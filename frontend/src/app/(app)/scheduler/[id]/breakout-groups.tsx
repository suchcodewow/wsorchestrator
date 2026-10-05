"use client";

/**
 * A breakout's assessment and groups: a box for each of its instructors, with
 * the room they take it to, and the attendees it is taught to dragged into
 * them. Each instructor evaluates their group there on the assessment picked,
 * and finds them under Assigned to me on it in eVals. Anyone in no box, in
 * the box of someone since taken off the session, or on a track it no longer
 * teaches, is not assigned. Auto-assign shares out whoever is left and gives
 * each instructor without a room the smallest free one that seats their group.
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Crown, DoorOpen, Eraser, Loader2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUDIENCE_TRACKS, SCHEDULE_LIMITS, type ScheduleTrack, type SessionAudience } from "@/db/schema";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { RoomRow } from "@/lib/scheduler/facilities";
import type { GroupAttendee, GroupRow } from "@/lib/scheduler/groups";
import type { BreakoutAssessment, StaffRow } from "@/lib/scheduler/schedule";
import { describeClash, stageOf, type Clash } from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";

type Person = { email: string; fullName: string; title: string; track: GroupAttendee["track"] | null; inClass: boolean };

const POOL = "pool";
const TRACK_BADGES: Record<GroupAttendee["track"], string> = { sales: "Sales", engineer: "Eng" };

/** The groups a breakout keeps with this staff and audience, as the server prunes them when the session is saved. */
export function keptGroups(groups: GroupRow[], staff: StaffRow[], audience: SessionAudience): GroupRow[] {
  const onStaff = new Set(staff.map((s) => s.email));
  const taught = (track: string | null) => !(track === "sales" || track === "engineer") || AUDIENCE_TRACKS[audience].includes(track);
  return groups.filter((g) => onStaff.has(g.instructorEmail) && taught(g.track));
}

type GroupsProps = {
  bootcampId: string;
  /** Unset for a session not added yet, which has no groups. */
  sessionId: string | null;
  track: ScheduleTrack;
  audience: SessionAudience;
  staff: StaffRow[];
  /** The facility's rooms. */
  rooms: RoomRow[];
  /** What each room is busy with during the session. */
  busyRooms: Map<string, Clash[]>;
  /** The rooms the session held when opened, which stay pickable though busy. */
  beforeRooms: Set<string | null>;
  hasFacility: boolean;
  roomName: (id: string) => string;
  /** The groups as changed here; null until they are. */
  value: GroupRow[] | null;
  onChange: (groups: GroupRow[]) => void;
  /** Sets the rooms of the instructors named, by email; null for none. */
  onRooms: (rooms: Record<string, string | null>) => void;
  editable: boolean;
};

export function BreakoutGroups({
  assessments,
  assessmentId,
  onAssessment,
  ...rest
}: GroupsProps & {
  assessments: BreakoutAssessment[];
  assessmentId: string | null;
  onAssessment: (id: string | null) => void;
}) {
  return (
    <div className="grid gap-5">
      <AssessmentPick
        stage={stageOf(rest.track)}
        assessments={assessments}
        value={assessmentId}
        onChange={onAssessment}
        editable={rest.editable}
      />
      <Groups {...rest} />
    </div>
  );
}

/** The assessment the instructors score their groups on, of the stage the track is taught to. */
function AssessmentPick({
  stage,
  assessments,
  value,
  onChange,
  editable,
}: {
  stage: BreakoutAssessment["stage"];
  assessments: BreakoutAssessment[];
  value: string | null;
  onChange: (id: string | null) => void;
  editable: boolean;
}) {
  const offered = assessments.filter((a) => a.stage === stage && (a.active || a.id === value));
  const picked = assessments.find((a) => a.id === value) ?? null;
  const name = (a: BreakoutAssessment) => (a.active ? a.name : `${a.name} (inactive)`);

  if (!editable) {
    return (
      <p className="text-sm">
        <span className="font-medium">Assessment:</span>{" "}
        {picked ? name(picked) : <span className="text-muted-foreground">None</span>}
      </p>
    );
  }
  return (
    <div className="grid gap-1.5">
      <label htmlFor="breakout-assessment" className="text-sm font-medium">
        Assessment
      </label>
      <select
        id="breakout-assessment"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className={cn(
          "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30",
          !value && "text-muted-foreground",
        )}
      >
        <option value="">{offered.length === 0 ? `No active ${STAGE_LABELS[stage]} assessments` : "None"}</option>
        {offered.map((a) => (
          <option key={a.id} value={a.id}>
            {name(a)}
          </option>
        ))}
      </select>
      {!value && offered.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Pick one so each instructor finds their group under Assigned to me in eVals.</p>
      )}
    </div>
  );
}

function Groups({
  bootcampId,
  sessionId,
  track,
  audience,
  staff,
  rooms,
  busyRooms,
  beforeRooms,
  hasFacility,
  roomName,
  value,
  onChange,
  onRooms,
  editable,
}: GroupsProps) {
  const [saved, setSaved] = useState<GroupRow[] | null>(sessionId ? null : []);
  const [cls, setCls] = useState<{ key: string; attendees: GroupAttendee[]; hasMore: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /** What auto-assign could not do, until the next change. */
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    fetch(`/api/scheduler/bootcamps/${bootcampId}/sessions/${sessionId}/groups`, { cache: "no-store" })
      .then(async (res) => {
        const out = await res.json().catch(() => null);
        if (!live) return;
        if (res.ok) setSaved(out.groups);
        else if (res.status === 404) setSaved([]);
        else setError(`Could not load the groups (${res.status}).`);
      })
      .catch(() => live && setError("Could not reach the server."));
    return () => {
      live = false;
    };
  }, [bootcampId, sessionId]);

  const classKey = `${track}|${audience}`;
  useEffect(() => {
    let live = true;
    fetch(`/api/scheduler/bootcamps/${bootcampId}/attendees?track=${track}&audience=${audience}`, { cache: "no-store" })
      .then(async (res) => {
        const out = await res.json().catch(() => null);
        if (!live) return;
        if (res.ok) setCls({ key: classKey, attendees: out.attendees, hasMore: out.hasMore });
        else setError(`Could not load who this session is taught to (${res.status}).`);
      })
      .catch(() => live && setError("Could not reach the server."));
    return () => {
      live = false;
    };
  }, [bootcampId, track, audience, classKey]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  const groups = value ?? saved;
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!groups || !cls || cls.key !== classKey) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;

  const placed = keptGroups(groups, staff, audience);
  const placedAt = new Map(placed.map((g) => [g.email, g.instructorEmail]));
  const inClass = new Map(cls.attendees.map((a) => [a.email, a]));

  const people = new Map<string, Person>([
    ...cls.attendees.map((a) => [a.email, { ...a, inClass: true }] as const),
    ...groups.filter((g) => !inClass.has(g.email)).map((g) => [g.email, { email: g.email, fullName: g.fullName, title: "", track: null, inClass: false }] as const),
  ]);
  // Someone in a box who has left the class stays there; out of one, they are gone.
  const pool = cls.attendees.filter((a) => !placedAt.has(a.email)).map((a) => people.get(a.email)!);
  const boxOf = (instructor: string) => placed.filter((g) => g.instructorEmail === instructor).map((g) => people.get(g.email)!);
  const total = new Set([...cls.attendees.map((a) => a.email), ...placed.map((g) => g.email)]).size;

  if (staff.length === 0) {
    return <p className="text-sm text-muted-foreground">Add instructors on the Session tab to give each of them a group and a room.</p>;
  }

  const move = (email: string, to: string) => {
    if ((placedAt.get(email) ?? POOL) === to) return;
    const rest = placed.filter((g) => g.email !== email);
    const who = people.get(email);
    const track = who?.track ?? groups.find((g) => g.email === email)?.track ?? null;
    setNote(null);
    onChange(to === POOL || !who ? rest : [...rest, { email, fullName: who.fullName, instructorEmail: to, track }]);
  };

  /** Rooms nobody else on the session has, and not busy then unless the session already held them. */
  const freeRooms = (except: string) => {
    const taken = new Set(staff.flatMap((s) => (s.email !== except && s.roomId ? [s.roomId] : [])));
    return rooms.filter((r) => !taken.has(r.id) && !((busyRooms.get(r.id)?.length ?? 0) > 0 && !beforeRooms.has(r.id)));
  };
  const roomless = rooms.length > 0 ? staff.filter((s) => !s.roomId) : [];

  /**
   * Shares out everyone not assigned, each to whichever group is smallest
   * then; then gives each instructor without a room the smallest free one
   * that seats their group and them, the largest group choosing first.
   */
  const autoAssign = () => {
    const next = [...placed];
    const sizes = new Map(staff.map((s) => [s.email, next.filter((g) => g.instructorEmail === s.email).length]));
    for (const p of pool) {
      const [to] = [...sizes].reduce((a, b) => (b[1] < a[1] ? b : a));
      next.push({ email: p.email, fullName: p.fullName, instructorEmail: to, track: p.track });
      sizes.set(to, sizes.get(to)! + 1);
    }
    onChange(next.slice(0, SCHEDULE_LIMITS.groupPeople));

    let free = freeRooms("").sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name));
    const picks: Record<string, string | null> = {};
    const unseated: string[] = [];
    for (const s of [...roomless].sort((a, b) => sizes.get(b.email)! - sizes.get(a.email)!)) {
      const room = free.find((r) => r.capacity >= sizes.get(s.email)! + 1);
      if (!room) {
        unseated.push(`${s.fullName} (${sizes.get(s.email)! + 1} with them)`);
        continue;
      }
      picks[s.email] = room.id;
      free = free.filter((r) => r !== room);
    }
    if (Object.keys(picks).length > 0) onRooms(picks);
    setNote(unseated.length > 0 ? `No free room seats the group of ${unseated.join(", ")}.` : null);
  };

  /** Everyone back to not assigned, and every instructor's room to none. */
  const removeAll = () => {
    onChange([]);
    onRooms(Object.fromEntries(staff.map((s) => [s.email, null])));
    setNote(null);
  };
  const anyAssigned = placed.length > 0 || staff.some((s) => s.roomId);

  const onDragStart = (e: DragStartEvent) => setDragging(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (e.over) move(String(e.active.id), String(e.over.id));
  };
  const held = dragging ? people.get(dragging) : null;

  return (
    <DndContext id={`groups-${sessionId ?? "new"}`} sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm tabular-nums">
            {placed.length} of {total} assigned
            {cls.hasMore && <span className="text-muted-foreground"> · showing the first {SCHEDULE_LIMITS.groupPeople} in the class</span>}
          </p>
          {editable && (
            <div className="flex flex-wrap gap-2">
              {anyAssigned && (
                <Button type="button" size="sm" variant="ghost" onClick={removeAll}>
                  <Eraser />
                  Remove all assignments
                </Button>
              )}
              {(pool.length > 0 || roomless.length > 0) && (
                <Button type="button" size="sm" variant="outline" onClick={autoAssign}>
                  <WandSparkles />
                  Auto-assign
                </Button>
              )}
            </div>
          )}
        </div>
        {note && <p className="-mt-2 text-xs text-red-700 dark:text-red-400">{note}</p>}
        {!hasFacility && (
          <p className="-mt-2 text-xs text-muted-foreground">Pick a facility for this bootcamp on the Scheduler to give each instructor a room.</p>
        )}

        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No one is in this class right now, so there is no one to assign.</p>
        ) : (
          <Box id={POOL} title="Not assigned" count={pool.length} people={pool} editable={editable} empty="Everyone is in a group." />
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {staff.map((s) => (
            <Box
              key={s.email}
              id={s.email}
              title={s.fullName}
              leader={s.leader}
              room={
                editable && rooms.length > 0 ? (
                  <RoomSelect
                    label={`${s.fullName}'s room`}
                    value={s.roomId}
                    rooms={rooms}
                    free={new Set(freeRooms(s.email).map((r) => r.id))}
                    busy={busyRooms}
                    onChange={(r) => {
                      setNote(null);
                      onRooms({ [s.email]: r });
                    }}
                  />
                ) : s.roomId ? (
                  <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    <DoorOpen className="size-3 shrink-0" />
                    <span className="truncate">{roomName(s.roomId)}</span>
                  </span>
                ) : null
              }
              count={boxOf(s.email).length}
              people={boxOf(s.email)}
              editable={editable}
              empty={editable ? "Drag people here." : "No one yet."}
            />
          ))}
        </div>
      </div>

      {createPortal(
        // Above the dialog, whose transform would otherwise offset it.
        <DragOverlay dropAnimation={null} zIndex={60}>
          {held && <Chip person={held} lifted />}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

function Box({
  id,
  title,
  leader,
  room,
  count,
  people,
  editable,
  empty,
}: {
  id: string;
  title: string;
  leader?: boolean;
  /** Where the instructor takes the group, or a control to pick it. */
  room?: ReactNode;
  count: number;
  people: Person[];
  editable: boolean;
  empty: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !editable });
  return (
    <section
      ref={setNodeRef}
      aria-label={id === POOL ? title : `${title}'s group`}
      className={cn(
        "grid min-h-24 content-start gap-2 rounded-xl border p-3 transition-colors",
        id === POOL ? "border-dashed bg-muted/30" : "bg-card",
        isOver && "border-brand-border bg-brand/8",
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        {leader && <Crown aria-label="Leader" className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />}
        <span className="min-w-0 truncate font-medium">{title}</span>
        <span className="text-muted-foreground tabular-nums">{count}</span>
        {room && <div className="ml-auto flex min-w-0">{room}</div>}
      </div>
      {people.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {people.map((p) => (
            <li key={p.email}>
              <DraggableChip person={p} editable={editable} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DraggableChip({ person, editable }: { person: Person; editable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: person.email, disabled: !editable });
  return (
    <div ref={setNodeRef} {...(editable ? { ...attributes, ...listeners } : {})} className={cn(editable && "cursor-grab touch-none", isDragging && "opacity-30")}>
      <Chip person={person} />
    </div>
  );
}

function Chip({ person: p, lifted }: { person: Person; lifted?: boolean }) {
  return (
    <span
      title={p.inClass ? [p.email, p.title].filter(Boolean).join(" · ") : `${p.email} · no longer in this class`}
      className={cn(
        "inline-flex max-w-56 items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs",
        lifted && "cursor-grabbing shadow-lg ring-2 ring-brand/50",
        !p.inClass && "border-amber-300 text-amber-900 dark:border-amber-800 dark:text-amber-200",
      )}
    >
      <span className="truncate">{p.fullName || p.email}</span>
      {p.track ? <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">{TRACK_BADGES[p.track]}</span> : <span className="shrink-0 text-[10px]">Left</span>}
    </span>
  );
}

/**
 * A breakout instructor's room. Rooms another instructor has, or busy then,
 * are listed with why and cannot be picked; the one they have always can.
 */
function RoomSelect({
  label,
  value,
  rooms,
  free,
  busy,
  onChange,
}: {
  label: string;
  value: string | null;
  rooms: RoomRow[];
  free: Set<string>;
  busy: Map<string, Clash[]>;
  onChange: (room: string | null) => void;
}) {
  const mine = value ? (busy.get(value) ?? []) : [];
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        "h-7 max-w-44 min-w-0 cursor-pointer appearance-none truncate rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30",
        !value && "text-muted-foreground",
        mine.length > 0 && "border-red-400 text-red-700 dark:text-red-400",
      )}
    >
      <option value="">No room</option>
      {rooms.map((r) => {
        const theirs = busy.get(r.id) ?? [];
        const why = free.has(r.id) ? `holds ${r.capacity}` : theirs.length > 0 ? `busy: ${describeClash(theirs[0]!)}` : "another instructor's";
        return (
          <option key={r.id} value={r.id} disabled={r.id !== value && !free.has(r.id)}>
            {r.name} ({why})
          </option>
        );
      })}
    </select>
  );
}

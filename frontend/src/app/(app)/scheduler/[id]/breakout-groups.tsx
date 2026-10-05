"use client";

/**
 * A breakout's groups: a box for each of its instructors, and the attendees
 * it is taught to dragged into them. Each instructor takes their group to
 * their room and evaluates it on the exercise. Anyone in no box, in the box of
 * someone since taken off the session, or on a track it no longer teaches, is
 * not assigned.
 */

import { useEffect, useState } from "react";
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
import { Crown, DoorOpen, Loader2, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUDIENCE_TRACKS, SCHEDULE_LIMITS, type ScheduleTrack, type SessionAudience } from "@/db/schema";
import type { GroupAttendee, GroupRow } from "@/lib/scheduler/groups";
import type { StaffRow } from "@/lib/scheduler/schedule";
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

export function BreakoutGroups({
  bootcampId,
  sessionId,
  track,
  audience,
  staff,
  roomName,
  value,
  onChange,
  editable,
}: {
  bootcampId: string;
  /** Unset for a session not added yet, which has no groups. */
  sessionId: string | null;
  track: ScheduleTrack;
  audience: SessionAudience;
  staff: StaffRow[];
  roomName: (id: string) => string;
  /** The groups as changed here; null until they are. */
  value: GroupRow[] | null;
  onChange: (groups: GroupRow[]) => void;
  editable: boolean;
}) {
  const [saved, setSaved] = useState<GroupRow[] | null>(sessionId ? null : []);
  const [cls, setCls] = useState<{ key: string; attendees: GroupAttendee[]; hasMore: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

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
    return <p className="text-sm text-muted-foreground">Add instructors on the Session tab to give each of them a group.</p>;
  }
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No one is in this class right now, so there is no one to assign.</p>;
  }

  const move = (email: string, to: string) => {
    if ((placedAt.get(email) ?? POOL) === to) return;
    const rest = placed.filter((g) => g.email !== email);
    const who = people.get(email);
    const track = who?.track ?? groups.find((g) => g.email === email)?.track ?? null;
    onChange(to === POOL || !who ? rest : [...rest, { email, fullName: who.fullName, instructorEmail: to, track }]);
  };

  /** Shares out everyone not assigned, each to whichever group is smallest then. */
  const splitEvenly = () => {
    const next = [...placed];
    const sizes = new Map(staff.map((s) => [s.email, next.filter((g) => g.instructorEmail === s.email).length]));
    for (const p of pool) {
      const [to] = [...sizes].reduce((a, b) => (b[1] < a[1] ? b : a));
      next.push({ email: p.email, fullName: p.fullName, instructorEmail: to, track: p.track });
      sizes.set(to, sizes.get(to)! + 1);
    }
    onChange(next.slice(0, SCHEDULE_LIMITS.groupPeople));
  };

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
          {editable && pool.length > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={splitEvenly}>
              <Shuffle />
              Split evenly
            </Button>
          )}
        </div>

        <Box id={POOL} title="Not assigned" count={pool.length} people={pool} editable={editable} empty="Everyone is in a group." />

        <div className="grid gap-3 sm:grid-cols-2">
          {staff.map((s) => (
            <Box
              key={s.email}
              id={s.email}
              title={s.fullName}
              leader={s.leader}
              room={s.roomId ? roomName(s.roomId) : null}
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
  room?: string | null;
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
        {room && (
          <span className="ml-auto inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <DoorOpen className="size-3 shrink-0" />
            <span className="truncate">{room}</span>
          </span>
        )}
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

/**
 * A bootcamp's schedule to print, in ink rather than colour: one day of every
 * track side by side (`?day=3`, from All Tracks), or every day of one track
 * (`?track=btc_se`, from One Track). The schedule's print button opens it in
 * a tab of its own; it sits outside the app's shell so nothing else prints,
 * and fits a landscape page.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth, signInPath } from "@/auth";
import { SCHEDULE_LIMITS, SCHEDULE_TRACKS } from "@/db/schema";
import { canUseTraining } from "@/lib/roles";
import { loadSchedule, type SessionRow } from "@/lib/scheduler/schedule";
import { PRINT_STRIPES } from "@/lib/scheduler/session-style";
import { TRACK_LABELS, attendeeCount, dayDate, formatClock, trackDays } from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "Print schedule" };

const idSchema = z.string().uuid();
const querySchema = z.object({
  day: z.coerce.number().int().min(1).max(30).optional(),
  track: z.enum(SCHEDULE_TRACKS).optional(),
});

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const dateLabel = (iso: string) => WEEKDAY.format(new Date(`${iso}T00:00:00Z`));

/** The height of the grid's body, and of a line of a block's text, in CSS pixels. */
const BODY_PX = 6.4 * 96;
const LINE_PX = 11;

type PrintColumn = { key: string; title: string; detail?: string; sessions: SessionRow[] };

export default async function PrintSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  const id = idSchema.safeParse((await params).id);
  const query = querySchema.safeParse(await searchParams);
  if (!id.success || !query.success) notFound();
  const schedule = await loadSchedule(id.data);
  if (!schedule) notFound();
  const { bootcamp } = schedule;

  let view: string;
  let columns: PrintColumn[];
  if (query.data.track) {
    const track = query.data.track;
    const days = trackDays(track, bootcamp) ?? 0;
    if (days === 0) notFound();
    const who = attendeeCount(schedule.classes, track);
    view = `${TRACK_LABELS[track]} (${who.count} ${who.noun}), every day`;
    columns = Array.from({ length: days }, (_, i) => ({
      key: `${i + 1}`,
      title: `Day ${i + 1}`,
      detail: dateLabel(dayDate(bootcamp.startDate, i + 1)),
      sessions: schedule.days[track][i] ?? [],
    }));
  } else {
    const day = query.data.day ?? 1;
    const tracks = SCHEDULE_TRACKS.filter((t) => (trackDays(t, bootcamp) ?? 0) >= day);
    if (tracks.length === 0) notFound();
    view = `Day ${day} · ${dateLabel(dayDate(bootcamp.startDate, day))}, every track`;
    columns = tracks.map((t) => {
      const who = attendeeCount(schedule.classes, t);
      return { key: t, title: TRACK_LABELS[t], detail: `${who.count} ${who.noun}`, sessions: schedule.days[t][day - 1] ?? [] };
    });
  }

  // From the first hour anything starts to the hour after the last ends, and never less than the working day.
  const sessions = columns.flatMap((c) => c.sessions);
  const from = Math.floor(Math.min(SCHEDULE_LIMITS.dayStart, ...sessions.map((s) => s.start)) / 60) * 60;
  const to = Math.ceil(Math.max(SCHEDULE_LIMITS.dayEnd, ...sessions.map((s) => s.start + s.minutes)) / 60) * 60;
  const span = to - from;
  const pct = (minutes: number) => `${(minutes / span) * 100}%`;
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => from + i * 60);
  const roomNames = new Map(schedule.rooms.map((r) => [r.id, r.name]));

  return (
    <div className="min-h-screen bg-white text-neutral-900 scheme-light print:min-h-0">
      <style>{"@page { size: landscape; margin: 0.35in; }"}</style>
      <div className="mx-auto max-w-[10.3in] px-4 py-6 print:max-w-none print:p-0">
        <header className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">{MONTH_YEAR.format(new Date(`${bootcamp.startDate}T00:00:00Z`))} Bootcamp</h1>
            <p className="text-xs text-neutral-600">{view}</p>
          </div>
          <PrintButton />
        </header>

        <div className="flex border border-neutral-400 text-[9px] leading-[11px]">
          <div className="w-10 shrink-0 border-r border-neutral-400">
            <div className="h-9 border-b border-neutral-400" />
            <div className="relative h-[6.4in]">
              {hours.map((m) => (
                <div
                  key={m}
                  className="absolute right-1 -translate-y-1/2 text-neutral-600 tabular-nums first:translate-y-0 last:-translate-y-full"
                  style={{ top: pct(m - from) }}
                >
                  {formatClock(m).replace(":00", "")}
                </div>
              ))}
            </div>
          </div>

          {columns.map((c) => (
            <div key={c.key} className="min-w-0 flex-1 border-r border-neutral-400 last:border-r-0">
              <div className="flex h-9 flex-col justify-center border-b border-neutral-400 px-1.5">
                <div className="truncate text-[11px] leading-[13px] font-semibold">{c.title}</div>
                {c.detail && <div className="truncate text-neutral-600">{c.detail}</div>}
              </div>
              <div className="relative h-[6.4in]">
                {hours.slice(1, -1).map((m) => (
                  <div key={m} className="absolute inset-x-0 border-t border-neutral-200" style={{ top: pct(m - from) }} />
                ))}
                {c.sessions.map((s) => (
                  <PrintedSession
                    key={s.id}
                    session={s}
                    roomNames={roomNames}
                    top={pct(s.start - from)}
                    height={pct(s.minutes)}
                    lines={Math.floor(((s.minutes / span) * BODY_PX - 4) / LINE_PX)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PrintedSession({
  session: s,
  roomNames,
  top,
  height,
  lines,
}: {
  session: SessionRow;
  roomNames: Map<string, string>;
  top: string;
  height: string;
  /** How many lines of text the block has room for. */
  lines: number;
}) {
  const leader = s.staff.find((p) => p.leader) ?? s.staff[0];
  const rooms =
    s.kind === "main"
      ? s.roomId
        ? [roomNames.get(s.roomId) ?? "A removed room"]
        : []
      : s.kind === "breakout"
        ? s.staff.flatMap((p) => (p.roomId ? [roomNames.get(p.roomId) ?? "A removed room"] : []))
        : [];
  const people = [leader && `${leader.fullName}${s.staff.length > 1 ? ` +${s.staff.length - 1}` : ""}`, rooms.join(", ")]
    .filter(Boolean)
    .join(" · ");
  const time = `${formatClock(s.start)}–${formatClock(s.start + s.minutes)}`;

  return (
    <div className="absolute inset-x-0.5 py-px" style={{ top, height }}>
      <div
        className={cn(
          "h-full overflow-hidden rounded-[2px] border border-l-[3px] border-neutral-400 bg-white px-1 break-inside-avoid",
          PRINT_STRIPES[s.color],
        )}
      >
        {lines < 3 ? (
          <>
            <div className="flex min-w-0 items-baseline gap-1">
              <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
              <span className="shrink-0 text-neutral-600 tabular-nums">{time}</span>
            </div>
            {people && lines > 1 && <div className="truncate text-neutral-700">{people}</div>}
          </>
        ) : (
          <>
            {/* A block tall enough wraps its name and puts the time and people under it. */}
            <div
              className="font-semibold wrap-break-word"
              style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines - (people ? 2 : 1), overflow: "hidden" }}
            >
              {s.name}
            </div>
            <div className="truncate text-neutral-600 tabular-nums">{time}</div>
            {people && <div className="truncate text-neutral-700">{people}</div>}
          </>
        )}
      </div>
    </div>
  );
}

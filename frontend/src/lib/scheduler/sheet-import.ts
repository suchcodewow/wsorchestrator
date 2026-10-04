/**
 * Reads the Google Sheet's Schedule tab into sessions. The tab has a block of
 * columns per track, found by its "… Topic" header: time, length, icon, a
 * hidden copy of the topic, the topic, and "Team". Each row is ten minutes.
 * "DAYn" in the time column starts a day, a topic starts a session, "END DAY"
 * ends the day, and in the SE tracks "Return" sends the class back to the main
 * track until its next topic.
 *
 * The sheet runs on ten minutes and the schedule on fifteen, so every start
 * and end is rounded to the nearest quarter hour. A session that rounding
 * would shrink to nothing keeps one slot, and pushes the next one along
 * rather than overlapping it. Time between sessions becomes an "Unscheduled"
 * session, or in an SE track one saying the class is with the main track.
 *
 * The Team column's first name on a session is its leader and later names
 * are its other instructors; anything that is not a name becomes a line of
 * its description. Pure: the caller says who a name is.
 */

import { SCHEDULE_LIMITS, type ScheduleTrack, type SessionColor, type SessionKind } from "@/db/schema";
import type { Cell } from "@/lib/spreadsheet-file";
import { TRACK_LABELS } from "./timeline";

/** The session types the sheet's icons stand for, by the name they were seeded with. */
export const IMPORT_TYPES = {
  teach: { name: "Teach", kind: "main", emoji: "🧑‍🏫", color: "blue" },
  exam: { name: "Exam", kind: "main", emoji: "📝", color: "amber" },
  roleplay: { name: "Roleplay", kind: "breakout", emoji: "🎭", color: "violet" },
  break: { name: "Break", kind: "unstructured", emoji: "🕰️", color: "slate" },
  lunch: { name: "Lunch", kind: "unstructured", emoji: "🍔", color: "green" },
  unscheduled: { name: "Unscheduled", kind: "unstructured", emoji: "⏳", color: "slate" },
} as const satisfies Record<string, { name: string; kind: SessionKind; emoji: string; color: SessionColor }>;

export type ImportType = keyof typeof IMPORT_TYPES;

export type ImportPerson = { email: string; fullName: string };

export type ImportSession = {
  track: ScheduleTrack;
  day: number;
  /** Order within the day, from 0. */
  position: number;
  minutes: number;
  type: ImportType;
  name: string;
  description: string;
  /** The leader first, then the other instructors. Empty for an unstructured session. */
  staff: ImportPerson[];
  /** Where the sheet had it, in minutes after midnight, or null for time the import filled in. */
  sheetStart: number | null;
  sheetMinutes: number | null;
};

export type ParsedSchedule = {
  sessions: ImportSession[];
  /** What was left out or changed, in words, for the person importing. */
  notes: string[];
};

export class SheetImportError extends Error {
  constructor(readonly code: "not_schedule") {
    super(code);
  }
}

const HEADERS: [RegExp, ScheduleTrack][] = [
  [/^(btc|bootcamp)\s*se\b/i, "btc_se"],
  [/^int(ermediate)?\s*se\b/i, "int_se"],
  [/^(btc|bootcamp)\b/i, "btc"],
  [/^int(ermediate)?\b/i, "int"],
];

/** The topic column of each track, from the header row. */
function findTracks(header: readonly Cell[]): Map<ScheduleTrack, number> {
  const found = new Map<ScheduleTrack, number>();
  header.forEach((cell, col) => {
    const text = typeof cell === "string" ? cell.trim() : "";
    if (!/topic/i.test(text)) return;
    const track = HEADERS.find(([re]) => re.test(text))?.[1];
    if (track && !found.has(track) && col >= 4) found.set(track, col);
  });
  return found;
}

const text = (cell: Cell | undefined): string => (cell === null || cell === undefined ? "" : String(cell).trim());

/** Minutes after midnight: a fraction of a day from the `.xlsx`, or "8:00 A" / "12:50 PM" from a CSV. */
export function sheetClock(cell: Cell | undefined): number | null {
  if (typeof cell === "number") return cell >= 0 && cell < 1 ? Math.round(cell * 1440) : null;
  const m = /^(\d{1,2}):(\d{2})\s*([AP])\.?M?\.?$/i.exec(text(cell));
  if (!m) return null;
  const h = Number(m[1]) % 12 + (m[3]!.toUpperCase() === "P" ? 12 : 0);
  return h * 60 + Number(m[2]);
}

/** Minutes: a fraction of a day from the `.xlsx`, or "0:20" / "1:30" from a CSV. */
export function sheetLength(cell: Cell | undefined): number | null {
  if (typeof cell === "number") return cell > 0 && cell < 1 ? Math.round(cell * 1440) : null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(text(cell));
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes > 0 ? minutes : null;
}

const roundToSlot = (minute: number) => Math.round(minute / SCHEDULE_LIMITS.slot) * SCHEDULE_LIMITS.slot;

const BREAKOUT = /role ?plays?|\bcert(ification)?\b|final presentation|demo pr?actice/i;
const NOT_BREAKOUT = /tee up|debrief|set ?up|\bprep\b/i;

/** Which type a sheet topic is, from its icon and, for the 🧒 that stands for both, its name. */
export function sheetType(icon: string, topic: string): ImportType {
  if (icon.includes("📝")) return "exam";
  if (icon.includes("🍔")) return "lunch";
  if (icon.includes("🕰")) return "break";
  if (BREAKOUT.test(topic) && !NOT_BREAKOUT.test(topic)) return "roleplay";
  return "teach";
}

/** "BREAK" → "Break"; anything with a lowercase letter is left as written. */
function tidyName(topic: string): string {
  const name = /^[A-Z][A-Z &/]+$/.test(topic) ? topic.charAt(0) + topic.slice(1).toLowerCase() : topic;
  return name.slice(0, SCHEDULE_LIMITS.name);
}

/** One topic in the sheet, before rounding. */
type Event = {
  row: number;
  start: number;
  length: number | null;
  icon: string;
  topic: string;
  team: string;
};

/** A session with the Team lines that fall within it, still in the sheet's minutes. */
type Draft = {
  start: number;
  end: number;
  type: ImportType;
  name: string;
  lines: string[];
};

/**
 * The people a Team line names, or null if any part of it is not someone.
 * "Joey Kitz & Ignacio Bonomi" is two.
 */
function peopleIn(line: string, resolve: (name: string) => ImportPerson | null): ImportPerson[] | null {
  const parts = line.split(/\s*(?:&|,|\/|\band\b)\s*/i).filter(Boolean);
  if (parts.length === 0) return null;
  const people = parts.map((p) => resolve(p));
  return people.every((p): p is ImportPerson => p !== null) ? people : null;
}

/** Who runs a session and what its description says, from its Team lines. */
function readTeam(
  lines: readonly string[],
  kind: SessionKind,
  resolve: (name: string) => ImportPerson | null,
): { staff: ImportPerson[]; description: string } {
  const staff: ImportPerson[] = [];
  const notes: string[] = [];
  const add = (p: ImportPerson) => {
    if (!staff.some((s) => s.email === p.email)) staff.push(p);
  };
  for (const line of lines) {
    if (kind === "unstructured") {
      notes.push(line);
      continue;
    }
    const people = peopleIn(line, resolve);
    if (people) {
      people.forEach(add);
      continue;
    }
    // "Shawn Pearson - Icebreaker": someone, and a note about what they do.
    const split = /^(.+?)\s+[-–—]\s+(.+)$/.exec(line);
    const named = split ? peopleIn(split[1]!, resolve) : null;
    if (named) {
      named.forEach(add);
      notes.push(line);
    } else {
      notes.push(line);
    }
  }
  return {
    staff: staff.slice(0, SCHEDULE_LIMITS.staff),
    description: notes.join("\n").slice(0, SCHEDULE_LIMITS.description),
  };
}

/** The topics of one track, grouped by day, with the Team cells of the rows between them. */
function readTrack(rows: readonly (readonly Cell[])[], topicCol: number) {
  const timeCol = topicCol - 4;
  const days = new Map<number, { events: Event[]; team: { row: number; at: number; line: string }[] }>();
  let day: { events: Event[]; team: { row: number; at: number; line: string }[] } | null = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const marker = /^day\s*(\d+)$/i.exec(text(row[timeCol]));
    if (marker) {
      day = { events: [], team: [] };
      days.set(Number(marker[1]), day);
      continue;
    }
    if (!day) continue;
    const at = sheetClock(row[timeCol]);
    if (at === null) continue;
    const topic = text(row[topicCol]);
    const team = text(row[topicCol + 1]);
    if (topic) {
      day.events.push({
        row: r,
        start: at,
        length: sheetLength(row[timeCol + 1]),
        icon: text(row[timeCol + 2]),
        topic,
        team,
      });
    } else if (team) {
      day.team.push({ row: r, at, line: team });
    }
  }
  return days;
}

/**
 * One track-day's sessions, in the sheet's minutes. Team lines go to the
 * session they fall within; ones in the time between sessions go to that
 * time, and a note on END DAY goes to the day's last session.
 */
function draftDay(
  events: readonly Event[],
  team: readonly { row: number; at: number; line: string }[],
): { drafts: Draft[]; gapNotes: Map<number, string[]> } {
  const drafts: (Draft & { row: number })[] = [];
  // Notes in the time before drafts[i], keyed by i; drafts.length is after the last.
  const gapNotes = new Map<number, string[]>();
  let endRow = Infinity;
  const returnRows: number[] = [];

  for (const [i, e] of events.entries()) {
    if (/^end\s*day$/i.test(e.topic)) {
      endRow = e.row;
      if (e.team && drafts.length) drafts.at(-1)!.lines.push(`After the day: ${e.team}`);
      break;
    }
    if (/^return$/i.test(e.topic)) {
      returnRows.push(e.row);
      continue;
    }
    const next = events.slice(i + 1).find((n) => n.start > e.start);
    const end = e.length !== null ? e.start + e.length : next ? next.start : e.start + SCHEDULE_LIMITS.slot;
    drafts.push({
      row: e.row,
      start: e.start,
      end,
      type: sheetType(e.icon, e.topic),
      name: tidyName(e.topic),
      lines: e.team ? [e.team] : [],
    });
  }

  for (const t of team) {
    if (t.row > endRow) {
      if (drafts.length) drafts.at(-1)!.lines.push(`After the day: ${t.line}`);
      continue;
    }
    const before = drafts.filter((d) => d.row < t.row);
    const last = before.at(-1);
    const returned = last && returnRows.some((r) => r > last.row && r < t.row);
    if (last && !returned && t.at < last.end) {
      last.lines.push(t.line);
      continue;
    }
    gapNotes.set(before.length, [...(gapNotes.get(before.length) ?? []), t.line]);
  }
  return { drafts, gapNotes };
}

/**
 * The sessions of a Schedule tab. `days` is how many days each track runs
 * (null for one the bootcamp does not hold); anything past it is left out
 * and said so in `notes`.
 */
export function parseScheduleSheet(
  rows: readonly (readonly Cell[])[],
  options: {
    days: Record<ScheduleTrack, number | null>;
    resolve: (name: string) => ImportPerson | null;
  },
): ParsedSchedule {
  const tracks = findTracks(rows[0] ?? []);
  if (tracks.size === 0) throw new SheetImportError("not_schedule");

  const sessions: ImportSession[] = [];
  const notes: string[] = [];
  let moved = 0;

  for (const [track, topicCol] of tracks) {
    const label = TRACK_LABELS[track];
    const limit = options.days[track];
    const filler =
      track === "btc_se" ? "With Bootcamp" : track === "int_se" ? "With Intermediate" : IMPORT_TYPES.unscheduled.name;

    for (const [day, { events, team }] of [...readTrack(rows, topicCol)].sort((a, b) => a[0] - b[0])) {
      const { drafts, gapNotes } = draftDay(events, team);
      if (drafts.length === 0) continue;
      if (limit === null) {
        notes.push(`${label} day ${day} left out: this bootcamp has no ${track.startsWith("int") ? "Intermediate" : "Bootcamp"} class.`);
        continue;
      }
      if (day < 1 || day > limit) {
        notes.push(`${label} day ${day} left out: the track runs ${limit} day${limit === 1 ? "" : "s"}.`);
        continue;
      }

      const out: Omit<ImportSession, "position">[] = [];
      const fill = (from: number, to: number, lines: readonly string[]) => {
        for (let at = from; at < to; at += SCHEDULE_LIMITS.maxMinutes) {
          out.push({
            track,
            day,
            minutes: Math.min(SCHEDULE_LIMITS.maxMinutes, to - at),
            type: "unscheduled",
            name: filler,
            description: at === from ? lines.join("\n").slice(0, SCHEDULE_LIMITS.description) : "",
            staff: [],
            sheetStart: null,
            sheetMinutes: null,
          });
        }
      };

      let at = SCHEDULE_LIMITS.dayStart;
      drafts.forEach((d, i) => {
        const start = Math.max(at, roundToSlot(d.start));
        const end = Math.max(start + SCHEDULE_LIMITS.slot, roundToSlot(d.end));
        const pending = gapNotes.get(i) ?? [];
        if (start > at) fill(at, start, pending);
        const lines = start > at || pending.length === 0 ? d.lines : [...pending, ...d.lines];
        const kind = IMPORT_TYPES[d.type].kind;
        const { staff, description } = readTeam(lines, kind, options.resolve);
        if (start !== d.start || end - start !== d.end - d.start) moved++;
        // A session longer than the longest allowed keeps going as a second one.
        for (let from = start; from < end; from += SCHEDULE_LIMITS.maxMinutes) {
          out.push({
            track,
            day,
            minutes: Math.min(SCHEDULE_LIMITS.maxMinutes, end - from),
            type: d.type,
            name: from === start ? d.name : `${d.name} (continued)`.slice(0, SCHEDULE_LIMITS.name),
            description: from === start ? description : "",
            staff,
            sheetStart: from === start ? d.start : null,
            sheetMinutes: from === start ? d.end - d.start : null,
          });
        }
        at = end;
      });
      const trailing = gapNotes.get(drafts.length);
      if (trailing?.length) {
        const last = out.at(-1)!;
        last.description = [last.description, ...trailing].filter(Boolean).join("\n").slice(0, SCHEDULE_LIMITS.description);
      }

      if (out.length > SCHEDULE_LIMITS.sessionsPerDay) {
        notes.push(
          `${label} day ${day}: only the first ${SCHEDULE_LIMITS.sessionsPerDay} of its ${out.length} sessions were kept.`,
        );
      }
      out.slice(0, SCHEDULE_LIMITS.sessionsPerDay).forEach((s, position) => sessions.push({ ...s, position }));
    }
  }

  if (moved > 0) {
    notes.unshift(`${moved} session${moved === 1 ? "" : "s"} moved or resized to fit the quarter hour.`);
  }
  return { sessions, notes };
}

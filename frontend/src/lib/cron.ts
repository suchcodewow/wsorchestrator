/**
 * Five-field cron (minute hour day-of-month month day-of-week), read in an
 * IANA time zone: parsing one, checking it can be run by the Timed Jobs
 * dispatcher, finding when it last fell due and when it next will, and saying
 * it in words. Pure, so the Timed Jobs tab can preview a schedule as it is
 * typed and the dispatcher can decide what is due with the same code.
 *
 * The grammar is Cloud Scheduler's unix-cron with numbers only: `*`, a value,
 * a range `a-b`, a step `*\/n` or `a-b/n`, and lists of those. Day of week runs
 * 0–7, both 0 and 7 being Sunday. As in cron, a day of the month and a day of
 * the week both restricted match on either.
 */

/** How often Cloud Scheduler calls the dispatcher, in minutes; every minute a schedule names must be a multiple of it. */
export const TICK_MINUTES = 5;

/** How far back the dispatcher looks for a time it missed, say while a deploy rolled; one older is skipped, not run late. */
export const CATCH_UP_MINUTES = 30;

/** The furthest ahead a schedule's next run is looked for. */
const LOOKAHEAD_DAYS = 400;

export type Cron = {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  days: ReadonlySet<number>;
  months: ReadonlySet<number>;
  weekdays: ReadonlySet<number>;
  /** Whether day of month or day of week was `*`, for cron's either-or rule. */
  anyDay: boolean;
  anyWeekday: boolean;
};

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of the month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of the week", min: 0, max: 7 },
] as const;

function parseField(text: string, { name, min, max }: (typeof FIELDS)[number]): Set<number> | string {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return `"${part}" is not a valid ${name}`;
    const step = m[4] === undefined ? 1 : Number(m[4]);
    let from: number = min;
    let to: number = max;
    if (m[1] !== "*") {
      from = Number(m[2]);
      // `5/15` means from 5 to the end, in steps of 15, as in Vixie cron.
      to = m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? max : from;
    }
    if (from < min || to > max || from > to) return `${name} must be from ${min} to ${max}`;
    if (step < 1) return `a step must be at least 1`;
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): { ok: true; cron: Cron } | { ok: false; error: string } {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { ok: false, error: "A schedule has five fields: minute, hour, day of the month, month and day of the week" };
  const sets: Set<number>[] = [];
  for (const [i, field] of FIELDS.entries()) {
    const set = parseField(parts[i]!, field);
    if (typeof set === "string") return { ok: false, error: set[0]!.toUpperCase() + set.slice(1) };
    sets.push(set);
  }
  const weekdays = sets[4]!;
  if (weekdays.delete(7)) weekdays.add(0);
  return {
    ok: true,
    cron: {
      minutes: sets[0]!,
      hours: sets[1]!,
      days: sets[2]!,
      months: sets[3]!,
      weekdays,
      anyDay: parts[2] === "*",
      anyWeekday: parts[4] === "*",
    },
  };
}

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone.length > 0;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Clock arithmetic in a zone                                          */
/* ------------------------------------------------------------------ */

type Local = { minute: number; hour: number; day: number; month: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The zone's offset from UTC at `t`, in milliseconds. */
function offsetAt(zone: string, t: number): number {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return asUtc - Math.floor(t / 60_000) * 60_000;
}

/**
 * Reads instants in a zone. Zones change offset on a half hour at the finest,
 * so one offset is good for each half hour of UTC.
 */
function zoneReader(zone: string): (t: number) => Local {
  const offsets = new Map<number, number>();
  return (t) => {
    const slot = Math.floor(t / 1_800_000);
    let offset = offsets.get(slot);
    if (offset === undefined) {
      offset = offsetAt(zone, slot * 1_800_000);
      offsets.set(slot, offset);
    }
    const d = new Date(t + offset);
    return { minute: d.getUTCMinutes(), hour: d.getUTCHours(), day: d.getUTCDate(), month: d.getUTCMonth() + 1, weekday: d.getUTCDay() };
  };
}

function matches(cron: Cron, at: Local): boolean {
  if (!cron.minutes.has(at.minute) || !cron.hours.has(at.hour) || !cron.months.has(at.month)) return false;
  const day = cron.days.has(at.day);
  const weekday = cron.weekdays.has(at.weekday);
  if (cron.anyDay && cron.anyWeekday) return true;
  if (cron.anyDay) return weekday;
  if (cron.anyWeekday) return day;
  return day || weekday;
}

const MINUTE = 60_000;
const STEP = TICK_MINUTES * MINUTE;

/**
 * The latest time at or before `now`, and no more than `CATCH_UP_MINUTES`
 * back, that `cron` falls due in `zone`; null if none. Only multiples of
 * `TICK_MINUTES` are looked at, which a valid schedule is all it names.
 */
export function lastDue(cron: Cron, zone: string, now: Date): Date | null {
  const local = zoneReader(zone);
  const latest = Math.floor(now.getTime() / STEP) * STEP;
  for (let t = latest; t > now.getTime() - CATCH_UP_MINUTES * MINUTE; t -= STEP) {
    if (matches(cron, local(t))) return new Date(t);
  }
  return null;
}

/** The next `count` times after `from` that `cron` falls due in `zone`, within about a year. */
export function nextDue(cron: Cron, zone: string, from: Date, count = 1): Date[] {
  const local = zoneReader(zone);
  const out: Date[] = [];
  const end = from.getTime() + LOOKAHEAD_DAYS * 24 * 60 * MINUTE;
  for (let t = Math.floor(from.getTime() / STEP) * STEP + STEP; t <= end && out.length < count; t += STEP) {
    if (matches(cron, local(t))) out.push(new Date(t));
  }
  return out;
}

/**
 * Why the dispatcher cannot run `expr` in `zone`, or null if it can: it must
 * parse, name only minutes the dispatcher's tick lands on, and fall due at
 * least once in the coming year.
 */
export function scheduleProblem(expr: string, zone: string, now = new Date()): string | null {
  if (!isTimeZone(zone)) return `"${zone}" is not a time zone`;
  const parsed = parseCron(expr);
  if (!parsed.ok) return parsed.error;
  const off = [...parsed.cron.minutes].filter((m) => m % TICK_MINUTES !== 0);
  if (off.length > 0) return `Jobs are started every ${TICK_MINUTES} minutes, so each minute must be a multiple of ${TICK_MINUTES}; ${off[0]} is not`;
  if (nextDue(parsed.cron, zone, now).length === 0) return "That schedule never falls due in the coming year";
  return null;
}

/* ------------------------------------------------------------------ */
/* In words                                                            */
/* ------------------------------------------------------------------ */

const ZONE_NAMES: Record<string, string> = {
  "America/New_York": "Eastern",
  "America/Chicago": "Central",
  "America/Denver": "Mountain",
  "America/Los_Angeles": "Pacific",
  UTC: "UTC",
  "Etc/UTC": "UTC",
};

export function zoneName(zone: string): string {
  return ZONE_NAMES[zone] ?? zone;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function clock(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * The usual shapes of schedule in words, such as "Daily at 3:00 AM Eastern";
 * null for anything else, which is shown as its cron.
 */
export function describeCron(expr: string, zone: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, day, month, weekday] = parts as [string, string, string, string, string];
  if (day !== "*" || month !== "*") return null;
  const where = zoneName(zone);
  const every = /^\*\/(\d+)$/.exec(minute);
  if (every && hour === "*" && weekday === "*") return `Every ${every[1]} minutes`;
  if (/^\d+$/.test(minute) && hour === "*" && weekday === "*") return `Hourly at :${String(Number(minute)).padStart(2, "0")}`;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
  const at = `${clock(Number(hour), Number(minute))} ${where}`;
  if (weekday === "*") return `Daily at ${at}`;
  if (weekday === "1-5") return `Weekdays at ${at}`;
  if (/^[0-7]$/.test(weekday)) return `${WEEKDAYS[Number(weekday) % 7]}s at ${at}`;
  return null;
}

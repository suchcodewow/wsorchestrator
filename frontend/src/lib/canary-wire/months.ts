/**
 * Canary Wire months. Content is filed under a month by its name's prefix
 * ("September 2026 - Flex Pricing"), because Mindtickle's API exposes no
 * sections, so a month is carried as that label, "September 2026", and
 * compared through `monthKey`.
 */

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** The months the picker always offers, whether or not they have content yet. */
export const FIRST_MONTH = "June 2026";
export const LAST_MONTH = "June 2027";

/** "September 2026" → 2026 × 12 + 9, for ordering; 0 for anything that isn't a month. */
export function monthKey(label: string): number {
  const bits = label.trim().split(/\s+/);
  if (bits.length !== 2) return 0;
  const index = MONTH_NAMES.findIndex((m) => m.toLowerCase() === bits[0]!.toLowerCase());
  const year = Number(bits[1]);
  if (index === -1 || !Number.isInteger(year)) return 0;
  return year * 12 + index + 1;
}

export function labelForKey(key: number): string {
  const year = Math.floor((key - 1) / 12);
  return `${MONTH_NAMES[(key - 1) % 12]} ${year}`;
}

export const byMonth = (a: string, b: string) => monthKey(a) - monthKey(b);

/** Every month from `start` to `end`, both included. */
export function monthRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let k = monthKey(start); k && k <= monthKey(end); k++) out.push(labelForKey(k));
  return out;
}

/** "2026-08" → "August 2026"; null for anything else. */
export function monthFromIso(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(iso);
  if (!m || +m[2]! < 1 || +m[2]! > 12) return null;
  return `${MONTH_NAMES[+m[2]! - 1]} ${m[1]}`;
}

/** "August 2026" → "2026-08". */
export function isoFromMonth(label: string): string {
  const key = monthKey(label);
  const year = Math.floor((key - 1) / 12);
  return `${year}-${String(((key - 1) % 12) + 1).padStart(2, "0")}`;
}

/**
 * The month after the one a day falls in: "2026-08-12" → "September 2026".
 * A rep counts for the Canary Wire from the month after their bootcamp, so
 * the month they spent attending it is never held against them.
 */
export function monthAfterDay(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(day);
  if (!m) return null;
  return labelForKey(+m[1]! * 12 + +m[2]! + 1);
}

/**
 * The first whole month from a day on: that month when it is the 1st, the
 * next otherwise. "2026-10-02" → "November 2026"; "2026-10-01" → "October 2026".
 */
export function firstFullMonth(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return labelForKey(+m[1]! * 12 + +m[2]! + (m[3] === "01" ? 0 : 1));
}

const PACIFIC = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/**
 * An ISO instant as "Sep 24, 2026 at 6:14 AM PDT". Every stamp on the page is
 * Pacific, named PDT or PST from the date itself so it stays honest across
 * the DST change. A bare date gives "": read as midnight UTC it would land on
 * the evening before in Pacific, a wrong day shown with confidence.
 */
export function toPacific(iso: string | null | undefined): string {
  if (!iso || iso.length <= 10) return "";
  const at = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(at.getTime())) return "";
  const p = Object.fromEntries(PACIFIC.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.month} ${p.day}, ${p.year} at ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
}

/**
 * IANA time zones as the app keeps and asks them (`America/Chicago`), shared
 * by the HiBob sync, the Pre-Bootcamp form and the unit suite. Pure.
 */

/** Whether `value` names a time zone this runtime knows, spelled as IANA does. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Every zone the runtime lists, in name order. */
export function timeZoneNames(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

/** `UTC-06:00` or `UTC+05:30`: `zone`'s offset from UTC at `at`. */
export function utcOffsetLabel(zone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  // "GMT-06:00", or plain "GMT" at zero.
  return part && part !== "GMT" ? part.replace("GMT", "UTC") : "UTC+00:00";
}

/** How a zone reads in a list: `(UTC-06:00) America/Chicago`. */
export function timeZoneLabel(zone: string, at: Date = new Date()): string {
  return `(${utcOffsetLabel(zone, at)}) ${zone.replace(/_/g, " ")}`;
}

/** The zone that stands for its offset in the list when it is not the person's own, where one of these has it. */
const REPRESENTATIVE_ZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "America/Halifax",
  "America/Sao_Paulo",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Athens",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/** `zone`'s offset from UTC at `at`, in minutes. */
export function utcOffsetMinutes(zone: string, at: Date = new Date()): number {
  const match = /([+-])(\d{2}):(\d{2})$/.exec(utcOffsetLabel(zone, at));
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * One zone per UTC offset at `at`, soonest-west first, so a list of them is
 * short and reads in order of the offset rather than of any place's name.
 * `current`, the zone the person has now, stands for its own offset; any other
 * offset is stood for by a well-known zone on it, else the first by name.
 */
export function timeZoneChoices(at: Date = new Date(), current?: string | null): { value: string; label: string }[] {
  const byOffset = new Map<number, string[]>();
  const zones = timeZoneNames();
  if (current && isTimeZone(current) && !zones.includes(current)) zones.push(current);
  for (const zone of zones) {
    const minutes = utcOffsetMinutes(zone, at);
    byOffset.set(minutes, [...(byOffset.get(minutes) ?? []), zone]);
  }
  return [...byOffset.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, names]) => {
      const value =
        (current && names.includes(current) ? current : undefined) ??
        REPRESENTATIVE_ZONES.find((z) => names.includes(z)) ??
        names[0]!;
      return { value, label: timeZoneLabel(value, at) };
    });
}

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

/** `zone`'s offset from UTC at `at`, in minutes. */
export function utcOffsetMinutes(zone: string, at: Date = new Date()): number {
  const match = /([+-])(\d{2}):(\d{2})$/.exec(utcOffsetLabel(zone, at));
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * Every zone, soonest-west first by its offset at `at` and then by name, each
 * labelled with that offset. The list is the whole IANA set rather than one zone
 * per offset, because zones that share an offset today differ on daylight
 * saving (Phoenix and Los Angeles in summer), and Slack's own zone for a person
 * must stay choosable. `current`, the zone the person has now, is listed even
 * where the runtime knows it only as an alias.
 */
export function timeZoneChoices(at: Date = new Date(), current?: string | null): { value: string; label: string }[] {
  const zones = timeZoneNames();
  if (current && isTimeZone(current) && !zones.includes(current)) zones.push(current);
  return zones
    .map((value) => ({ value, minutes: utcOffsetMinutes(value, at) }))
    .sort((a, b) => a.minutes - b.minutes || a.value.localeCompare(b.value))
    .map(({ value }) => ({ value, label: timeZoneLabel(value, at) }));
}

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

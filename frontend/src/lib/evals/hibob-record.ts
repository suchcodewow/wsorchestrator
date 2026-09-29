/**
 * Turns one employee from HiBob's `/v1/people/search` into a row to store.
 *
 * Asked for with `humanReadable: "APPEND"`, each record carries its fields
 * three times: nested (`work.title` is a numeric code), flattened under
 * `/work/title`-style keys, and readable under `humanReadable` (`work.title`
 * is "Senior Sales Engineer"). The readable copy is where titles and
 * departments come from; the flattened keys are dropped from what is kept.
 */

export type HibobEmployeeRow = {
  id: string;
  email: string;
  fullName: string;
  title: string;
  department: string;
  site: string;
  reportsToEmail: string;
  reportsToName: string;
  startDate: string | null;
  activeEffectiveDate: string | null;
  raw: Record<string, unknown>;
};

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

/** HiBob's nested dates are ISO; anything else is treated as missing. */
function isoDate(value: unknown): string | null {
  const s = str(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** The row for one HiBob employee, or null for a record with no id or email. */
export function toEmployeeRow(record: unknown): HibobEmployeeRow | null {
  const r = obj(record);
  const id = str(r.id);
  const email = str(r.email).toLowerCase();
  if (!id || !email) return null;

  const work = obj(r.work);
  const readable = obj(obj(r.humanReadable).work);
  const reportsTo = obj(work.reportsTo);

  return {
    id,
    email,
    fullName: str(r.fullName) || str(r.displayName) || email,
    title: str(readable.title),
    department: str(readable.department),
    site: str(work.site) || str(readable.site),
    reportsToEmail: str(reportsTo.email).toLowerCase(),
    reportsToName: str(reportsTo.displayName),
    startDate: isoDate(work.startDate),
    activeEffectiveDate: isoDate(work.activeEffectiveDate),
    raw: Object.fromEntries(Object.entries(r).filter(([key]) => !key.startsWith("/"))),
  };
}

/** The `Authorization` header for a HiBob service user. */
export function hibobAuthorization(serviceUserId: string, token: string): string {
  return `Basic ${Buffer.from(`${serviceUserId}:${token}`).toString("base64")}`;
}

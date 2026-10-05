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

/** A word as an email spells it: letters only, lowercased, without accents. */
function bare(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
}

/** What HiBob puts where it has no name: "LNU", "FNU", or a lone "." or "-". */
const PLACEHOLDER = /^(?:lnu|fnu|[^\p{L}]+)$/iu;

/**
 * The words of `words`, in a row, that spell `part` once accents, hyphens and
 * spaces are set aside, as HiBob writes them ("Al-Shahwany", "José"); or
 * `part` capitalised when the name has no such words, as for a nickname.
 */
function spell(part: string, words: string[]): string {
  const want = bare(part);
  for (let i = 0; i < words.length; i++) {
    let joined = "";
    for (let j = i; j < words.length && joined.length < want.length; j++) {
      joined += bare(words[j]);
      if (joined === want) return words.slice(i, j + 1).join(" ");
    }
  }
  return part
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("-");
}

/**
 * The name the app shows for someone: their first and last name as their
 * email has them, `first.last@`, so "Geoffrey Marshall Lochausen" is
 * "Geoffrey Lochausen". A contractor's `c_` and a trailing number
 * (`abhinav.singh3`) are dropped, and of more than two parts only the first
 * and last count. An email that is not `first.last` keeps HiBob's name, less
 * its placeholders.
 */
export function nameFromEmail(email: string, fullName: string): string {
  const words = fullName.split(/\s+/).filter((w) => w && !PLACEHOLDER.test(w));
  const parts = email
    .split("@")[0]
    .replace(/^c_/, "")
    .split(".")
    .map((p) => p.replace(/\d+$/, ""))
    .filter((p) => bare(p));
  if (parts.length < 2) return words.join(" ") || fullName;
  return `${spell(parts[0], words)} ${spell(parts[parts.length - 1], words)}`;
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
  const reportsToEmail = str(reportsTo.email).toLowerCase();
  const reportsToName = str(reportsTo.displayName);

  return {
    id,
    email,
    fullName: nameFromEmail(email, str(r.fullName) || str(r.displayName) || email),
    title: str(readable.title),
    department: str(readable.department),
    site: str(work.site) || str(readable.site),
    reportsToEmail,
    reportsToName: reportsToEmail ? nameFromEmail(reportsToEmail, reportsToName) : reportsToName,
    startDate: isoDate(work.startDate),
    activeEffectiveDate: isoDate(work.activeEffectiveDate),
    raw: Object.fromEntries(Object.entries(r).filter(([key]) => !key.startsWith("/"))),
  };
}

/** The `Authorization` header for a HiBob service user. */
export function hibobAuthorization(serviceUserId: string, token: string): string {
  return `Basic ${Buffer.from(`${serviceUserId}:${token}`).toString("base64")}`;
}

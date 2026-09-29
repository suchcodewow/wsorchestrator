/**
 * The checks a bootcamp history email and date must pass, shared by the
 * sheet reader, the API and the edit form.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The email lowercased and trimmed, or null if it isn't one. */
export function normalEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return EMAIL.test(email) ? email : null;
}

/** `YYYY-MM-DD` if it names a real day, otherwise null. */
export function validIso(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Whether the text is a `YYYY-MM-DD` real day. */
export function isIsoDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m !== null && validIso(+m[1]!, +m[2]!, +m[3]!) === value;
}

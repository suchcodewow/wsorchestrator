import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a string is shaped like a UUID.
 *
 * Postgres raises on a malformed uuid literal rather than simply not matching,
 * so a query comparing a `uuid` column against a value straight off a URL turns
 * `/api/…/not-a-uuid` into a 500 instead of a 404. Checked before the query, so
 * an id that could not name anything is answered as "no such row" — which is
 * what it is.
 */
export const isUuid = (value: string): boolean => UUID.test(value);

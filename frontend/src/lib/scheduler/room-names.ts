/**
 * No two rooms of one facility share a name. Names are the same when they
 * differ only in case or spacing, so "Main Hall" and " main  hall" are one
 * room. The facility editor checks as you type; the API checks again.
 */

const keyOf = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Whether two names are the same room's. */
export const sameRoomName = (a: string, b: string) => keyOf(a) === keyOf(b);

/** The indexes of rooms named like an earlier one, in order; blank names are left to other checks. */
export function repeatedRooms(rooms: readonly { name: string }[]): number[] {
  const seen = new Set<string>();
  const repeats: number[] = [];
  rooms.forEach((r, i) => {
    const key = keyOf(r.name);
    if (!key) return;
    if (seen.has(key)) repeats.push(i);
    seen.add(key);
  });
  return repeats;
}

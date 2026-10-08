/**
 * The order of a checklist board's cards within each half-day: pure, so the
 * board's preview as a card is dragged, what it shows once the card is
 * dropped, and the unit suite all agree with `moveChecklistItem`, which saves
 * the same order.
 */

import type { ChecklistPeriod } from "@/db/schema";

export type Placed = { id: string; day: number; period: ChecklistPeriod; position: number; createdAt: string };

/** In order on the board: by place, and by when it was added where two share one. */
export const byPlace = (a: Placed, b: Placed) =>
  a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * `list` with the item `id` moved to `index` among the other items of the
 * half-day `to`, first at 0, and that half renumbered from 0; past the end is
 * the end. The half it left keeps its numbers, gap and all, as the server does.
 */
export function placeInHalf<T extends Placed>(list: readonly T[], id: string, to: { day: number; period: ChecklistPeriod; index: number }): T[] {
  const moving = list.find((i) => i.id === id);
  if (!moving) return [...list];
  const others = list.filter((i) => i.id !== id && i.day === to.day && i.period === to.period).sort(byPlace);
  const at = Math.min(Math.max(to.index, 0), others.length);
  const order = [...others.slice(0, at), { ...moving, day: to.day, period: to.period }, ...others.slice(at)];
  const placed = new Map(order.map((item, position) => [item.id, { ...item, position }]));
  return list.map((i) => placed.get(i.id) ?? i).sort(byPlace);
}

/**
 * A half-day's cards as they show while one is dragged: the card at `landing`
 * when that is this half, missing from this half when it is landing in
 * another, and where it was when it is over no half at all.
 */
export function previewHalf<T extends Placed>(
  here: readonly T[],
  half: { day: number; period: ChecklistPeriod },
  dragged: T | null,
  landing: { day: number; period: ChecklistPeriod; index: number } | null,
): T[] {
  if (!dragged || !landing) return [...here];
  const others = here.filter((i) => i.id !== dragged.id);
  if (landing.day !== half.day || landing.period !== half.period) return others;
  const at = Math.min(Math.max(landing.index, 0), others.length);
  return [...others.slice(0, at), dragged, ...others.slice(at)];
}

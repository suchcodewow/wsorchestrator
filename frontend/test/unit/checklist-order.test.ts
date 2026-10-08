/** The order of a checklist board's cards in each half-day: placing a dropped card, and the preview as one is dragged. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { byPlace, placeInHalf, previewHalf, type Placed } from "../../src/lib/scheduler/checklist-order";

const card = (id: string, position: number, period: "am" | "pm" = "am", day = 1): Placed => ({
  id,
  day,
  period,
  position,
  createdAt: `2026-10-01T00:00:0${position}.000Z`,
});

const names = (list: Placed[], period: "am" | "pm" = "am") => list.filter((i) => i.period === period).map((i) => `${i.id}${i.position}`);

const AM = [card("a", 0), card("b", 1), card("c", 2), card("d", 3)];

test("cards are in place order, and by when they were added where two share a place", () => {
  const tied = [card("late", 0), { ...card("early", 0), createdAt: "2026-09-01T00:00:00.000Z" }];
  assert.deepEqual([...tied].sort(byPlace).map((i) => i.id), ["early", "late"]);
});

test("a card dragged up its half lands there, and the half is numbered again from 0", () => {
  assert.deepEqual(names(placeInHalf(AM, "d", { day: 1, period: "am", index: 1 })), ["a0", "d1", "b2", "c3"]);
});

test("a card dragged down lands after the card it passed", () => {
  assert.deepEqual(names(placeInHalf(AM, "a", { day: 1, period: "am", index: 2 })), ["b0", "c1", "a2", "d3"]);
});

test("a place past the end is the end, and one before the start the start", () => {
  assert.deepEqual(names(placeInHalf(AM, "b", { day: 1, period: "am", index: 99 })), ["a0", "c1", "d2", "b3"]);
  assert.deepEqual(names(placeInHalf(AM, "c", { day: 1, period: "am", index: -3 })), ["c0", "a1", "b2", "d3"]);
});

test("a card dragged into the other half lands among its cards, and the half it left keeps its numbers", () => {
  const list = [...AM, card("x", 0, "pm"), card("y", 1, "pm")];
  const moved = placeInHalf(list, "b", { day: 1, period: "pm", index: 1 });
  assert.deepEqual(names(moved, "pm"), ["x0", "b1", "y2"]);
  assert.deepEqual(names(moved, "am"), ["a0", "c2", "d3"]);
});

test("an unknown card changes nothing", () => {
  assert.deepEqual(placeInHalf(AM, "nope", { day: 1, period: "am", index: 0 }), AM);
});

test("while dragged, a card shows where it would land, leaves the half it is not over, and is back home over no half", () => {
  const dragged = AM[3]!;
  const here = { day: 1, period: "am" } as const;
  assert.deepEqual(previewHalf(AM, here, dragged, { day: 1, period: "am", index: 0 }).map((i) => i.id), ["d", "a", "b", "c"]);
  assert.deepEqual(previewHalf(AM, here, dragged, { day: 1, period: "pm", index: 0 }).map((i) => i.id), ["a", "b", "c"]);
  assert.deepEqual(previewHalf(AM, here, dragged, null).map((i) => i.id), ["a", "b", "c", "d"]);
  const pm = { day: 1, period: "pm" } as const;
  assert.deepEqual(previewHalf([card("x", 0, "pm")], pm, dragged, { day: 1, period: "pm", index: 1 }).map((i) => i.id), ["x", "d"]);
});

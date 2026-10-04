/**
 * When sessions happen and what clashes. Day N of every track is the same
 * day, so a person or room in two overlapping sessions across tracks clashes.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  busyDuring,
  dayTotal,
  findClashes,
  formatClock,
  formatLength,
  place,
  snapMinutes,
  trackDays,
  type ClashSession,
} from "@/lib/scheduler/timeline";

const john = { email: "john@example.com", fullName: "John Doe", roomId: null };
const jane = { email: "jane@example.com", fullName: "Jane Roe", roomId: null };

function session(id: string, over: Partial<ClashSession> = {}): ClashSession {
  return { id, track: "btc", day: 1, minutes: 60, kind: "main", name: id, roomId: null, staff: [], ...over };
}

describe("times", () => {
  test("clock and length read the way the sheet did", () => {
    assert.equal(formatClock(480), "8:00 AM");
    assert.equal(formatClock(720), "12:00 PM");
    assert.equal(formatClock(1035), "5:15 PM");
    assert.equal(formatLength(45), "45m");
    assert.equal(formatLength(120), "2h");
    assert.equal(formatLength(90), "1h 30m");
  });

  test("lengths snap to a whole number of quarter hours", () => {
    assert.equal(snapMinutes(0), 15);
    assert.equal(snapMinutes(22), 15);
    assert.equal(snapMinutes(23), 30);
    assert.equal(snapMinutes(10_000), 600);
  });

  test("a day says how long is left, or how far over it runs", () => {
    assert.deepEqual(dayTotal([{ minutes: 480 }]), { end: 960, left: 60, over: 0 });
    assert.deepEqual(dayTotal([{ minutes: 540 }]), { end: 1020, left: 0, over: 0 });
    assert.deepEqual(dayTotal([{ minutes: 300 }, { minutes: 270 }]), { end: 1050, left: 0, over: 30 });
  });

  test("the SE tracks run as long as the class they break out of", () => {
    const camp = { btcDays: 4, intDays: null };
    assert.equal(trackDays("btc_se", camp), 4);
    assert.equal(trackDays("int_se", camp), null);
  });
});

describe("clashes", () => {
  test("someone teaching 8–9 on Bootcamp cannot also start 8:45 on Intermediate", () => {
    const placed = place([
      [session("teach", { staff: [john] })],
      [session("opener", { track: "int", minutes: 45 }), session("pam", { track: "int", staff: [john] })],
    ]);
    const clashes = findClashes(placed);
    assert.deepEqual(
      clashes.get("pam")?.map((c) => [c.sessionId, c.what.kind]),
      [["teach", "person"]],
    );
    assert.deepEqual(
      clashes.get("teach")?.map((c) => [c.sessionId, c.start, c.end]),
      [["pam", 525, 585]],
    );
    assert.equal(clashes.has("opener"), false);
  });

  test("one session ending as another starts is not a clash", () => {
    const placed = place([
      [session("a", { staff: [john] })],
      [session("gap", { track: "int" }), session("b", { track: "int", staff: [john] })],
    ]);
    assert.equal(findClashes(placed).size, 0);
  });

  test("different days never clash", () => {
    const placed = place([[session("a", { staff: [john] })], [session("b", { day: 2, staff: [john] })]]);
    assert.equal(findClashes(placed).size, 0);
  });

  test("a main session's room and each breakout instructor's room are taken", () => {
    const placed = place([
      [session("teach", { roomId: "stanford" })],
      [
        session("roleplay", {
          track: "int",
          kind: "breakout",
          staff: [
            { ...jane, roomId: "stanford" },
            { ...john, roomId: "oxford" },
          ],
        }),
      ],
    ]);
    const clashes = findClashes(placed);
    assert.deepEqual(
      clashes.get("roleplay")?.map((c) => c.what),
      [{ kind: "room", roomId: "stanford" }],
    );
  });

  test("an unstructured session takes up no one and no room, whatever it was saved with", () => {
    const placed = place([
      [session("teach", { staff: [john], roomId: "main" })],
      [session("lunch", { track: "int", kind: "unstructured", staff: [john], roomId: "main" })],
    ]);
    assert.equal(findClashes(placed).size, 0);
  });

  test("who and what is busy during a time, leaving out the session being edited", () => {
    const placed = place([[session("teach", { staff: [john], roomId: "stanford" })]]);
    const busy = busyDuring(placed, { day: 1, start: 530, end: 570 });
    assert.deepEqual([...busy.people.keys()], ["john@example.com"]);
    assert.deepEqual([...busy.rooms.keys()], ["stanford"]);
    const self = busyDuring(placed, { day: 1, start: 480, end: 540, excludeId: "teach" });
    assert.equal(self.people.size + self.rooms.size, 0);
  });
});

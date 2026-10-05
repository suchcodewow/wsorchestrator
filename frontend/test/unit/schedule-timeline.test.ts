/**
 * When sessions happen, where a moved one lands, and what clashes. Day N of
 * every track is the same day, so a person or room in two overlapping
 * sessions across tracks clashes, and so do the attendees of a class and its
 * SE track taught two things at once.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  audienceClashes,
  busyDuring,
  dayTotal,
  dropAt,
  findClashes,
  fitsDay,
  formatClock,
  formatLength,
  gapsOf,
  place,
  settle,
  snapMinutes,
  snapStart,
  trackDays,
  type ClashSession,
} from "@/lib/scheduler/timeline";

const john = { email: "john@example.com", fullName: "John Doe", roomId: null };
const jane = { email: "jane@example.com", fullName: "Jane Roe", roomId: null };

function session(id: string, over: Partial<ClashSession> = {}): ClashSession {
  return { id, track: "btc", day: 1, start: 480, minutes: 60, kind: "main", audience: "both", name: id, roomId: null, staff: [], ...over };
}

/** A day as `id@start` in start order. */
const order = (sessions: readonly { id: string; start: number }[]) => sessions.map((s) => `${s.id}@${s.start}`);

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
    assert.deepEqual(dayTotal([]), { end: 480, left: 540, over: 0 });
    assert.deepEqual(dayTotal([{ start: 480, minutes: 480 }]), { end: 960, left: 60, over: 0 });
    assert.deepEqual(dayTotal([{ start: 480, minutes: 540 }]), { end: 1020, left: 0, over: 0 });
    assert.deepEqual(dayTotal([{ start: 480, minutes: 300 }, { start: 780, minutes: 270 }]), { end: 1050, left: 0, over: 30 });
  });

  test("time between sessions counts as left, not just time after the last", () => {
    assert.deepEqual(dayTotal([{ start: 600, minutes: 60 }]), { end: 660, left: 480, over: 0 });
  });

  test("the unscheduled time is before, between and after the sessions, as far as the end of the day", () => {
    const gaps = gapsOf([
      { start: 720, minutes: 60 },
      { start: 540, minutes: 60 },
    ]);
    assert.deepEqual(gaps, [
      { start: 480, minutes: 60 },
      { start: 600, minutes: 120 },
      { start: 780, minutes: 240 },
    ]);
    assert.deepEqual(gapsOf([{ start: 480, minutes: 540 }]), []);
    assert.deepEqual(gapsOf([]), [{ start: 480, minutes: 540 }]);
  });

  test("a start snaps to the quarter hour, from 8 AM, and early enough to end by midnight", () => {
    assert.equal(snapStart(547, 60), 540);
    assert.equal(snapStart(553, 60), 555);
    assert.equal(snapStart(300, 60), 480);
    assert.equal(snapStart(1430, 120), 1320);
  });

  test("the SE tracks run as long as the class they break out of", () => {
    const camp = { btcDays: 4, intDays: null };
    assert.equal(trackDays("btc_se", camp), 4);
    assert.equal(trackDays("int_se", camp), null);
  });
});

describe("moving sessions", () => {
  const a = session("a", { start: 480 });
  const b = session("b", { start: 600 });
  const c = session("c", { start: 660 });

  test("dropped into unscheduled time, it stays there and nothing else moves", () => {
    const day = dropAt([a, b], c, 840);
    assert.deepEqual(order(day), ["a@480", "b@600", "c@840"]);
  });

  test("it can go anywhere, with nothing before it", () => {
    assert.deepEqual(order(dropAt([], a, 720)), ["a@720"]);
  });

  test("on the top half of a session it takes that one's place, and the rest are pushed on", () => {
    const day = dropAt([a, b, c], session("new", { start: 0 }), 615);
    assert.deepEqual(order(day), ["a@480", "new@600", "b@660", "c@720"]);
  });

  test("on the bottom half it goes straight after that one", () => {
    const day = dropAt([a, b], session("new", { start: 0 }), 645);
    assert.deepEqual(order(day), ["a@480", "b@600", "new@660"]);
  });

  test("a push uses up the unscheduled time before it moves anything further", () => {
    // a runs 8–9, leaving 9–10 free before b. Put a 90-minute session at 8:30's slot:
    // it takes a's place, a goes to 9:30, and b is pushed only to 10:30.
    const long = session("long", { start: 0, minutes: 90 });
    const day = dropAt([a, b, session("d", { start: 840 })], long, 480);
    assert.deepEqual(order(day), ["long@480", "a@570", "b@630", "d@840"]);
  });

  test("moving a session down the same day leaves a gap where it was", () => {
    const day = dropAt([a, b, c], a, 900);
    assert.deepEqual(order(day), ["b@600", "c@660", "a@900"]);
  });

  test("settling keeps each start unless the one before runs into it", () => {
    const day = settle([session("x", { start: 480, minutes: 120 }), session("y", { start: 540 }), session("z", { start: 720 })]);
    assert.deepEqual(order(day), ["x@480", "y@600", "z@720"]);
  });

  test("a day fits when nothing overlaps and nothing runs past midnight", () => {
    assert.equal(fitsDay([a, b, c]), true);
    assert.equal(fitsDay([a, session("y", { start: 510 })]), false);
    assert.equal(fitsDay([session("late", { start: 1410, minutes: 60 })]), false);
    assert.equal(fitsDay([session("odd", { start: 490 })]), false);
  });
});

describe("clashes", () => {
  test("someone teaching 8–9 on Bootcamp cannot also start 8:45 on Intermediate", () => {
    const placed = place([
      [session("teach", { staff: [john] })],
      [session("opener", { track: "int", minutes: 45 }), session("pam", { track: "int", start: 525, staff: [john] })],
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
      [session("gap", { track: "int" }), session("b", { track: "int", start: 540, staff: [john] })],
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

describe("audience clashes", () => {
  test("a Bootcamp session for both clashes with an SE Bootcamp session for engineers beside it", () => {
    const placed = place([
      [session("overview")],
      [session("demo", { track: "btc_se", audience: "engineers", start: 510 })],
    ]);
    const clashes = findClashes(placed);
    assert.deepEqual(clashes.get("overview")?.map((c) => [c.sessionId, c.what]), [["demo", { kind: "audience", group: "engineers" }]]);
    assert.deepEqual(clashes.get("demo")?.map((c) => [c.sessionId, c.what]), [["overview", { kind: "audience", group: "engineers" }]]);
  });

  test("sales on Bootcamp while engineers break out is the plan, not a clash", () => {
    const placed = place([[session("discovery", { audience: "sales" })], [session("demo", { track: "btc_se", audience: "engineers" })]]);
    assert.equal(findClashes(placed).size, 0);
  });

  test("two sessions for both clash once for each group", () => {
    const placed = place([[session("a")], [session("b", { track: "btc_se" })]]);
    assert.deepEqual(
      findClashes(placed).get("a")?.map((c) => c.what),
      [
        { kind: "audience", group: "sales" },
        { kind: "audience", group: "engineers" },
      ],
    );
  });

  test("Bootcamp and SE Intermediate are different people", () => {
    const placed = place([[session("a")], [session("b", { track: "int_se", audience: "engineers" })]]);
    assert.equal(findClashes(placed).size, 0);
  });

  test("an unstructured session teaches no one: SE's \"With Bootcamp\" does not clash with what it points at", () => {
    const placed = place([
      [session("exam"), session("lunch", { start: 540, kind: "unstructured" })],
      [session("with", { track: "btc_se", kind: "unstructured", audience: "engineers" }), session("demo", { track: "btc_se", start: 540, audience: "engineers" })],
    ]);
    assert.equal(findClashes(placed).size, 0);
  });

  test("the dialog sees the same clash for a session not yet saved, and leaves out the one being edited", () => {
    const placed = place([[session("overview")], [session("demo", { track: "btc_se", audience: "engineers" })]]);
    const slot = { day: 1, start: 480, end: 540 };
    assert.deepEqual(audienceClashes(placed, { track: "btc", kind: "main", audience: "both" }, slot).map((c) => c.sessionId), ["demo"]);
    assert.deepEqual(audienceClashes(placed, { track: "btc", kind: "main", audience: "sales" }, slot), []);
    assert.deepEqual(audienceClashes(placed, { track: "btc_se", kind: "main", audience: "engineers" }, { ...slot, excludeId: "demo" }).map((c) => c.sessionId), ["overview"]);
  });
});

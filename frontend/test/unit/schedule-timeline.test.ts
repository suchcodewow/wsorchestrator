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
  checklistAlarmApplies,
  checklistDayLabel,
  checklistMarked,
  dayTotal,
  dropAt,
  findClashes,
  fitsDay,
  formatClock,
  formatLength,
  gapsOf,
  place,
  roomAt,
  settle,
  sideBySide,
  snapMinutes,
  snapStart,
  swapAt,
  trackDays,
  type ClashSession,
} from "@/lib/scheduler/timeline";

const john = { email: "john@example.com", fullName: "John Doe", roomId: null };
const jane = { email: "jane@example.com", fullName: "Jane Roe", roomId: null };

function session(id: string, over: Partial<ClashSession & { lane: number }> = {}): ClashSession & { lane?: number } {
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
    assert.deepEqual(
      dayTotal([
        { start: 480, minutes: 300 },
        { start: 780, minutes: 270 },
      ]),
      { end: 1050, left: 0, over: 30 },
    );
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

  test("the unscheduled time runs into the evening as far as the board goes", () => {
    assert.deepEqual(gapsOf([], 1080), [{ start: 480, minutes: 600 }]);
    assert.deepEqual(gapsOf([{ start: 480, minutes: 540 }], 1080), [{ start: 1020, minutes: 60 }]);
    assert.deepEqual(gapsOf([{ start: 1020, minutes: 60 }], 1140), [
      { start: 480, minutes: 540 },
      { start: 1080, minutes: 60 },
    ]);
  });

  test("only a Day item of a class-day is marked on the schedule, and only while it is to do", () => {
    const item = { day: 2, period: "am" as const, alarm: 600, done: false };
    assert.equal(checklistMarked(item), true);
    assert.equal(checklistMarked({ ...item, done: true }), false);
    assert.equal(checklistMarked({ ...item, alarm: null }), false);
    assert.equal(checklistMarked({ ...item, period: "pm" }), false);
    assert.equal(checklistMarked({ ...item, day: 0 }), false);
    assert.equal(checklistAlarmApplies({ day: 0, period: "am" }), false);
    assert.equal(checklistAlarmApplies({ day: 3, period: "pm" }), false);
    assert.equal(checklistDayLabel("btc", 2, "pm"), "Bootcamp, Day 2 · Evening");
    assert.equal(checklistDayLabel("btc", 0, "am"), "Prep Day · Day");
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

describe("moving a session up or down its own column", () => {
  const a = session("a", { start: 480 });
  const b = session("b", { start: 540, minutes: 90 });
  const c = session("c", { start: 660 });

  test("dragged down onto the next session, the two swap and nothing after them moves", () => {
    // a's middle at 10:00 is in b (9:00–10:30): b goes to 8:00, a ends where b did.
    assert.deepEqual(order(swapAt([a, b, c], "a", 570)), ["b@480", "a@570", "c@660"]);
  });

  test("dragged up onto the one before, the two swap", () => {
    assert.deepEqual(order(swapAt([a, b, c], "c", 540)), ["a@480", "c@540", "b@630"]);
  });

  test("the unscheduled time between the two stays where it is", () => {
    const later = session("d", { start: 720 });
    assert.deepEqual(order(swapAt([a, later], "a", 720)), ["d@480", "a@720"]);
  });

  test("swapped past a session between them, that one moves only within the span", () => {
    const x = session("x", { start: 480, minutes: 30 });
    const y = session("y", { start: 510, minutes: 60 });
    const z = session("z", { start: 570, minutes: 60 });
    const w = session("w", { start: 630 });
    assert.deepEqual(order(swapAt([x, y, z, w], "x", 585)), ["z@480", "y@540", "x@600", "w@630"]);
  });

  test("into unscheduled time it fits in, it goes there and nothing else moves", () => {
    assert.deepEqual(order(swapAt([a, c], "c", 600)), ["a@480", "c@600"]);
  });

  test("slid to fit the unscheduled time its middle is in, rather than pushing", () => {
    // 9:00–11:00 is free; dropped at 10:15 its end would run into d at 11:00, so it ends there instead.
    const d = session("d", { start: 660 });
    const e = session("e", { start: 900 });
    assert.deepEqual(order(swapAt([a, d, e], "e", 615)), ["a@480", "e@600", "d@660"]);
  });

  test("where it does not fit, it stays where it was", () => {
    const long = session("long", { start: 720, minutes: 120 });
    // The middle lands in the 9:00–10:00 gap, which is too short for two hours.
    const day = swapAt([a, session("m", { start: 600 }), long], "long", 480 + 30);
    assert.deepEqual(order(day), ["a@480", "m@600", "long@720"]);
  });
});

describe("the time free for a session", () => {
  const a = session("a", { start: 480 });
  const b = session("b", { start: 600 });

  test("runs to the next session in its lane", () => {
    assert.equal(roomAt([a, b], 540), 60);
    assert.equal(roomAt([a, b], 480, 0, "a"), 120);
  });

  test("ignores the other lanes, and stops at the longest a session may be", () => {
    assert.equal(roomAt([a, b], 480, 1), 600);
  });

  test("at the end of the day runs to midnight", () => {
    assert.equal(roomAt([session("late", { start: 1320 })], 1320, 0, "late"), 120);
  });
});

describe("sessions side by side", () => {
  const a = session("a", { start: 540 });
  const b = session("b", { start: 540, lane: 1 });
  const c = session("c", { start: 600 });
  /** A day as `id@start/lane`. */
  const laid = (sessions: readonly { id: string; start: number; lane?: number }[]) =>
    sessions.map((s) => `${s.id}@${s.start}/${s.lane ?? 0}`);

  test("a day fits with sessions overlapping in different lanes, but not in the same one", () => {
    assert.equal(fitsDay([a, b, c]), true);
    assert.equal(fitsDay([a, session("x", { start: 570 })]), false);
    assert.equal(fitsDay([a, session("x", { start: 540, lane: 3 })]), false);
  });

  test("a session put beside another stays there, and nothing in the main line moves", () => {
    const day = dropAt([a, c], session("new", { start: 0 }), 540, 1);
    assert.deepEqual(laid(day), ["a@540/0", "new@540/1", "c@600/0"]);
  });

  test("a push only moves the sessions of its own lane", () => {
    const day = settle([{ ...a, minutes: 90 }, b, c], "a");
    assert.deepEqual(laid(day), ["a@540/0", "b@540/1", "c@630/0"]);
  });

  test("a session that stops overlapping anything before it goes back to the main line", () => {
    assert.deepEqual(laid(settle([b, c])), ["b@540/0", "c@600/0"]);
    assert.deepEqual(laid(dropAt([a, b, c], a, 780)), ["b@540/0", "c@600/0", "a@780/0"]);
  });

  test("with the middle one gone, the third moves up beside the first", () => {
    const third = session("third", { start: 540, lane: 2 });
    assert.deepEqual(laid(settle([a, third])), ["a@540/0", "third@540/1"]);
  });

  test("a longer session beside a shorter one leaves the shorter one's column unscheduled to the group's end", () => {
    const groups = sideBySide([a, { ...b, minutes: 90 }, session("later", { start: 720 })]);
    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups[0]!.columns.map((c) => ({ lane: c.lane, ids: c.sessions.map((s) => s.id), gaps: c.gaps })),
      [
        { lane: 0, ids: ["a"], gaps: [{ start: 600, minutes: 30 }] },
        { lane: 1, ids: ["b"], gaps: [] },
      ],
    );
    assert.deepEqual(
      groups[1]!.columns.map((c) => c.gaps),
      [[]],
    );
  });

  test("time side by side counts once as scheduled", () => {
    assert.equal(dayTotal([a, b]).left, 480);
    assert.equal(dayTotal([session("late", { start: 1080 })]).left, 540);
  });

  test("sessions side by side on one track never clash over attendees, but do over a person", () => {
    const clashes = findClashes(place([[a, { ...b, staff: [] }]]));
    assert.equal(clashes.size, 0);
    const both = findClashes(
      place([
        [
          { ...a, staff: [john] },
          { ...b, staff: [john] },
        ],
      ]),
    );
    assert.equal(both.get("a")?.[0]?.what.kind, "person");
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
    const placed = place([[session("overview")], [session("demo", { track: "btc_se", audience: "engineers", start: 510 })]]);
    const clashes = findClashes(placed);
    assert.deepEqual(
      clashes.get("overview")?.map((c) => [c.sessionId, c.what]),
      [["demo", { kind: "audience", group: "engineers" }]],
    );
    assert.deepEqual(
      clashes.get("demo")?.map((c) => [c.sessionId, c.what]),
      [["overview", { kind: "audience", group: "engineers" }]],
    );
  });

  test("sales on Bootcamp while engineers break out is the plan, not a clash", () => {
    const placed = place([[session("discovery", { audience: "sales" })], [session("demo", { track: "btc_se", audience: "engineers" })]]);
    assert.equal(findClashes(placed).size, 0);
  });

  test("two sessions for both clash once for each group", () => {
    const placed = place([[session("a")], [session("b", { track: "btc_se" })]]);
    assert.deepEqual(
      findClashes(placed)
        .get("a")
        ?.map((c) => c.what),
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

  test('an unstructured session teaches no one: SE\'s "With Bootcamp" does not clash with what it points at', () => {
    const placed = place([
      [session("exam"), session("lunch", { start: 540, kind: "unstructured" })],
      [
        session("with", { track: "btc_se", kind: "unstructured", audience: "engineers" }),
        session("demo", { track: "btc_se", start: 540, audience: "engineers" }),
      ],
    ]);
    assert.equal(findClashes(placed).size, 0);
  });

  test("the dialog sees the same clash for a session not yet saved, and leaves out the one being edited", () => {
    const placed = place([[session("overview")], [session("demo", { track: "btc_se", audience: "engineers" })]]);
    const slot = { day: 1, start: 480, end: 540 };
    assert.deepEqual(
      audienceClashes(placed, { track: "btc", kind: "main", audience: "both" }, slot).map((c) => c.sessionId),
      ["demo"],
    );
    assert.deepEqual(audienceClashes(placed, { track: "btc", kind: "main", audience: "sales" }, slot), []);
    assert.deepEqual(
      audienceClashes(placed, { track: "btc_se", kind: "main", audience: "engineers" }, { ...slot, excludeId: "demo" }).map(
        (c) => c.sessionId,
      ),
      ["overview"],
    );
  });
});

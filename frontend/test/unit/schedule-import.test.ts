/**
 * Reading the Google Sheet's Schedule tab. The rows are laid out the way the
 * tab is: a block of columns per track (time, length, icon, a hidden copy of
 * the topic, the topic, Team), one row per ten minutes, "DAYn" starting a day.
 * Times are what a CSV export gives ("8:00 A", "0:20"); the `.xlsx` gives
 * fractions of a day, which the last test covers.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { ScheduleTrack } from "@/db/schema";
import type { Cell } from "@/lib/spreadsheet-file";
import {
  parseScheduleSheet,
  sheetClock,
  sheetLength,
  sheetType,
  SheetImportError,
  type ImportPerson,
} from "@/lib/scheduler/sheet-import";

const TOPIC: Record<ScheduleTrack, number> = { btc: 5, int: 11, btc_se: 17, int_se: 23 };
const HEADER: Cell[] = Array(25).fill(null);
HEADER[TOPIC.btc] = "Bootcamp Topic (18)";
HEADER[TOPIC.int] = "Intermediate Topic (20)";
HEADER[TOPIC.btc_se] = "BTC SE Topic (4)";
HEADER[TOPIC.int_se] = "INT SE Topic (5)";

type Line = { length?: string; icon?: string; topic?: string; team?: string };

/** A Schedule tab: for each day, each track's rows from 8:00 AM, ten minutes apart. */
function sheet(days: Partial<Record<ScheduleTrack, Line[]>>[]): Cell[][] {
  const rows: Cell[][] = [HEADER];
  days.forEach((tracks, d) => {
    const marker: Cell[] = Array(25).fill(null);
    for (const col of Object.values(TOPIC)) marker[col - 4] = `DAY${d + 1}`;
    rows.push(marker);
    const height = Math.max(...Object.values(tracks).map((lines) => lines.length));
    for (let i = 0; i < height; i++) {
      const row: Cell[] = Array(25).fill(null);
      const minute = 480 + i * 10;
      for (const [track, col] of Object.entries(TOPIC) as [ScheduleTrack, number][]) {
        const h = Math.floor(minute / 60);
        row[col - 4] = `${h > 12 ? h - 12 : h}:${String(minute % 60).padStart(2, "0")} ${h >= 12 ? "P" : "A"}`;
        const line = tracks[track]?.[i];
        if (!line) continue;
        row[col - 3] = line.length ?? "";
        row[col - 2] = line.icon ?? "";
        row[col] = line.topic ?? null;
        row[col + 1] = line.team ?? null;
      }
      rows.push(row);
    }
  });
  return rows;
}

const PEOPLE = ["Preston Tiegs", "Anndel Powers", "Joey Kitz", "Ignacio Bonomi", "Shawn Pearson"];
const resolve = (name: string): ImportPerson | null => {
  const hit = PEOPLE.find((p) => p.toLowerCase() === name.trim().toLowerCase());
  return hit ? { email: `${hit.split(" ")[0]!.toLowerCase()}@example.com`, fullName: hit } : null;
};
const DAYS = { btc: 4, btc_se: 4, int: 3, int_se: 3 };
const parse = (rows: Cell[][], days: Record<ScheduleTrack, number | null> = DAYS) =>
  parseScheduleSheet(rows, { days, resolve });

describe("the sheet's cells", () => {
  test("times and lengths read from a CSV or an .xlsx", () => {
    assert.equal(sheetClock("8:00 A"), 480);
    assert.equal(sheetClock("12:50 P"), 770);
    assert.equal(sheetClock("12:10 A"), 10);
    assert.equal(sheetClock("4:40 PM"), 1000);
    assert.equal(sheetClock(0.3333333333333333), 480);
    assert.equal(sheetClock("DAY1"), null);
    assert.equal(sheetLength("0:20 "), 20);
    assert.equal(sheetLength("1:30"), 90);
    assert.equal(sheetLength(0.01388888889), 20);
    assert.equal(sheetLength(""), null);
  });

  test("an icon decides the type, and the name tells a roleplay from teaching", () => {
    assert.equal(sheetType("📝", "Entrance Exam"), "exam");
    assert.equal(sheetType("🍔", "LUNCH & Prep for Roleplays w/ Yoodli"), "lunch");
    assert.equal(sheetType("🕰️", "Break & Judges Tally Scores"), "break");
    assert.equal(sheetType("🧒", "TSQ Role Plays Round 1"), "roleplay");
    assert.equal(sheetType("🧒", "Scoping & Connectivity Cert"), "roleplay");
    assert.equal(sheetType("🧒", "GnG Final Presentation"), "roleplay");
    assert.equal(sheetType("🧒", "Demo Practice first half"), "roleplay");
    assert.equal(sheetType("🧒", "TSQ Role Play Tee Up"), "teach");
    assert.equal(sheetType("🧒", "GnG Request Role Plays Debrief"), "teach");
    assert.equal(sheetType("🧒", "Final Set Up-Whiteboard Roleplays"), "teach");
    assert.equal(sheetType("🧒", "PG Overview"), "teach");
  });
});

describe("rounding to the quarter hour", () => {
  test("ten-minute sessions each keep a slot, in order, and none is lost", () => {
    const { sessions } = parse(
      sheet([
        {
          btc: [
            { length: "0:10", icon: "🧒", topic: "Recap" },
            { length: "0:10", icon: "🧒", topic: "Set up" },
            { length: "0:10", icon: "🕰️", topic: "BREAK" },
            { length: "0:30", icon: "🧒", topic: "Teach" },
          ],
        },
      ]),
    );
    assert.deepEqual(
      sessions.map((s) => [s.name, s.minutes]),
      [
        ["Recap", 15],
        ["Set up", 15],
        ["Break", 15],
        ["Teach", 15],
      ],
    );
    assert.ok(sessions.every((s) => s.minutes % 15 === 0 && s.minutes >= 15));
  });

  test("a session ends on its rounded end when it can, so later ones catch up", () => {
    // 8:00–8:20 → 8:00–8:15; 8:20–9:20 → 8:15–9:15.
    const { sessions } = parse(
      sheet([
        {
          btc: [
            { length: "0:20", icon: "📝", topic: "Entrance Exam" },
            {},
            { length: "1:00", icon: "🧒", topic: "Welcome" },
          ],
        },
      ]),
    );
    assert.deepEqual(
      sessions.map((s) => [s.name, s.minutes, s.sheetStart, s.sheetMinutes]),
      [
        ["Entrance Exam", 15, 480, 20],
        ["Welcome", 60, 500, 60],
      ],
    );
  });

  test("time between sessions stays unscheduled, each session keeping its start", () => {
    const { sessions } = parse(
      sheet([
        {
          btc: [{ length: "0:30", icon: "🧒", topic: "Teach" }, {}, {}, {}, {}, {}, { length: "0:30", icon: "🧒", topic: "More" }],
        },
      ]),
    );
    assert.deepEqual(
      sessions.map((s) => [s.name, s.type, s.start, s.minutes]),
      [
        ["Teach", "teach", 480, 30],
        ["More", "teach", 540, 30],
      ],
    );
  });

  test("a note in the time between sessions becomes an Unscheduled session holding it", () => {
    const { sessions } = parse(
      sheet([
        {
          btc: [
            { length: "0:30", icon: "🧒", topic: "Teach" },
            {},
            {},
            { team: "Set up the room" },
            {},
            {},
            { length: "0:30", icon: "🧒", topic: "More" },
          ],
        },
      ]),
    );
    assert.deepEqual(
      sessions.map((s) => [s.name, s.type, s.start, s.minutes, s.description]),
      [
        ["Teach", "teach", 480, 30, ""],
        ["Unscheduled", "unscheduled", 510, 30, "Set up the room"],
        ["More", "teach", 540, 30, ""],
      ],
    );
  });

  test("an SE track's time away is with the main track, through Return", () => {
    const { sessions } = parse(
      sheet([
        {
          btc_se: [{}, {}, {}, { length: "0:30", icon: "🧒", topic: "SE Teach" }, {}, {}, { icon: "👈", topic: "Return" }, {}, {}, { length: "0:30", icon: "🧒", topic: "SE Again" }],
        },
      ]),
    );
    assert.deepEqual(
      sessions.map((s) => [s.track, s.name, s.minutes]),
      [
        ["btc_se", "With Bootcamp", 30],
        ["btc_se", "SE Teach", 30],
        ["btc_se", "With Bootcamp", 30],
        ["btc_se", "SE Again", 30],
      ],
    );
  });

  test("nothing after END DAY is a session, and a note on it goes to the last one", () => {
    const { sessions } = parse(
      sheet([
        {
          btc: [
            { length: "0:30", icon: "🧒", topic: "Teach", team: "Preston Tiegs" },
            {},
            {},
            { icon: "🎉", topic: "END DAY", team: "Homework: prep" },
            { length: "0:30", icon: "🧒", topic: "Stray" },
          ],
        },
      ]),
    );
    assert.deepEqual(
      sessions.map((s) => [s.name, s.description]),
      [["Teach", "After the day: Homework: prep"]],
    );
  });
});

describe("the Team column", () => {
  test("the first name leads, later names instruct, and anything else describes", () => {
    const { sessions } = parse(
      sheet([
        {
          btc: [
            { length: "0:40", icon: "🧒", topic: "Roleplays", team: "Hand out kits" },
            { team: "Preston Tiegs" },
            { team: "Joey Kitz & Ignacio Bonomi" },
            { team: "5m per attempt" },
          ],
        },
      ]),
    );
    const [s] = sessions;
    assert.equal(s!.type, "roleplay");
    assert.deepEqual(
      s!.staff.map((p) => p.fullName),
      ["Preston Tiegs", "Joey Kitz", "Ignacio Bonomi"],
    );
    assert.equal(s!.description, "Hand out kits\n5m per attempt");
  });

  test("a name with a note is the person and the note", () => {
    const { sessions } = parse(
      sheet([{ btc: [{ length: "0:30", icon: "🧒", topic: "Teach", team: "Shawn Pearson - Icebreaker" }] }]),
    );
    assert.deepEqual(sessions[0]!.staff.map((p) => p.fullName), ["Shawn Pearson"]);
    assert.equal(sessions[0]!.description, "Shawn Pearson - Icebreaker");
  });

  test("lunch and breaks have nobody, so their Team lines are notes", () => {
    const { sessions } = parse(sheet([{ btc: [{ length: "0:30", icon: "🍔", topic: "LUNCH", team: "Preston Tiegs" }] }]));
    assert.deepEqual(sessions[0]!.staff, []);
    assert.equal(sessions[0]!.description, "Preston Tiegs");
  });

  test("a line after a session ends belongs to the time after it", () => {
    const { sessions } = parse(
      sheet([{ btc: [{ length: "0:20", icon: "🧒", topic: "Teach" }, {}, {}, { team: "Set up room" }, {}, {}, { length: "0:30", icon: "🧒", topic: "Next" }] }]),
    );
    assert.deepEqual(
      sessions.map((s) => [s.name, s.description]),
      [
        ["Teach", ""],
        ["Unscheduled", "Set up room"],
        ["Next", ""],
      ],
    );
  });
});

describe("what the bootcamp holds", () => {
  test("days past a track's length and a class it does not hold are left out, and said so", () => {
    const one = { length: "0:30", icon: "🧒", topic: "Teach" };
    const { sessions, notes } = parse(sheet([{ btc: [one], int: [one] }, { btc: [one], int: [one] }]), {
      btc: 1,
      btc_se: 1,
      int: null,
      int_se: null,
    });
    assert.deepEqual(
      sessions.map((s) => [s.track, s.day]),
      [["btc", 1]],
    );
    assert.ok(notes.some((n) => n.includes("Bootcamp day 2 left out")));
    assert.ok(notes.some((n) => n.includes("Intermediate day 1 left out")));
  });

  test("a sheet with no topic headers is not a schedule", () => {
    assert.throws(
      () => parse([["Name", "Email"], ["A", "a@example.com"]]),
      (e) => e instanceof SheetImportError && e.code === "not_schedule",
    );
  });

  test("an .xlsx gives times as fractions of a day", () => {
    const rows = sheet([{ btc: [{ length: "0:30", icon: "🧒", topic: "Teach" }] }]);
    rows[2]![TOPIC.btc - 4] = 0.3333333333333333;
    rows[2]![TOPIC.btc - 3] = 0.02083333333;
    const { sessions } = parse(rows);
    assert.deepEqual(
      sessions.map((s) => [s.sheetStart, s.minutes]),
      [[480, 30]],
    );
  });
});

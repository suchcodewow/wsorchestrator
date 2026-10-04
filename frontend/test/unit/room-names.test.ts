/** A facility's rooms can't share a name, whatever the case or spacing. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { repeatedRooms, sameRoomName } from "../../src/lib/scheduler/room-names";

const named = (...names: string[]) => names.map((name) => ({ name }));

test("distinct names repeat nothing", () => {
  assert.deepEqual(repeatedRooms(named("Main Hall", "Room 1", "Room 2")), []);
});

test("a name used again is the repeat, not the first use", () => {
  assert.deepEqual(repeatedRooms(named("Main Hall", "Room 1", "Main Hall")), [2]);
});

test("case and spacing don't make a name different", () => {
  assert.deepEqual(repeatedRooms(named("Main Hall", "main hall", " MAIN  HALL ")), [1, 2]);
});

test("blank names are left to the check that every room has a name", () => {
  assert.deepEqual(repeatedRooms(named("", "  ", "Room 1")), []);
});

test("sameRoomName ignores case and spacing", () => {
  assert.equal(sameRoomName("Main Hall", " main  HALL"), true);
  assert.equal(sameRoomName("Main Hall", "Main Hall 2"), false);
});

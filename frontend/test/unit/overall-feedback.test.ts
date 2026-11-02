/**
 * What Claude is sent to write a class's overall feedback, and how its reply
 * is read: only the feedback, under opaque ids, and nobody filed with a side
 * they were asked for left blank.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildOverallPrompt, readOverall, type OverallPerson } from "@/lib/reporting/overall-feedback";

const person = (over: Partial<OverallPerson> = {}): OverallPerson => ({
  id: "p1",
  positive: ["Clear demo"],
  constructive: ["Rushed the close"],
  writePositive: true,
  writeConstructive: true,
  ...over,
});

describe("buildOverallPrompt", () => {
  test("sends each piece of feedback escaped, under the person's id, with the sides to write", () => {
    const { user } = buildOverallPrompt([person({ positive: ["<b>Bold</b> & clear"], writeConstructive: false })]);
    assert.match(user, /<person id="p1" write="positive">/);
    assert.match(user, /<feedback>&lt;b&gt;Bold&lt;\/b&gt; &amp; clear<\/feedback>/);
    assert.match(user, /<feedback>Rushed the close<\/feedback>/);
  });
});

describe("readOverall", () => {
  test("keeps the sides asked for, trimmed, and blanks the rest", () => {
    const written = readOverall(
      [{ id: "p1", positive: " Shows strong demos. ", constructive: "Ignored" }],
      [person({ writeConstructive: false })],
    );
    assert.deepEqual(written.get("p1"), { positive: "Shows strong demos.", constructive: "" });
  });

  test("leaves out someone missing a side they were asked for, or missing altogether", () => {
    const written = readOverall(
      [{ id: "p1", positive: "Good.", constructive: " " }],
      [person(), person({ id: "p2" })],
    );
    assert.equal(written.size, 0);
  });
});

/**
 * What Claude is sent to write a class's overall feedback, and how its reply
 * is read: the feedback with its exercise and the person's first name, under
 * opaque ids, and nobody filed with a side they were asked for left blank.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildOverallPrompt, readOverall, type OverallPerson } from "@/lib/reporting/overall-feedback";

const person = (over: Partial<OverallPerson> = {}): OverallPerson => ({
  id: "p1",
  name: "Rick",
  positive: [{ exercise: "First Call / EMD", text: "Clear demo" }],
  constructive: [{ exercise: "Discovery/OU", text: "Rushed the close" }],
  writePositive: true,
  writeConstructive: true,
  ...over,
});

describe("buildOverallPrompt", () => {
  test("sends each piece of feedback escaped, under the person's id, with the sides to write", () => {
    const { user } = buildOverallPrompt([
      person({ positive: [{ exercise: 'SDA "Whiteboard"', text: "<b>Bold</b> & clear" }], writeConstructive: false }),
    ]);
    assert.match(user, /<person id="p1" name="Rick" write="positive">/);
    assert.match(user, /<feedback exercise="SDA &quot;Whiteboard&quot;">&lt;b&gt;Bold&lt;\/b&gt; &amp; clear<\/feedback>/);
    assert.match(user, /<feedback exercise="Discovery\/OU">Rushed the close<\/feedback>/);
  });

  test("tells Claude to keep the judges' specifics and not to guess at circumstances", () => {
    const { system } = buildOverallPrompt([person()]);
    assert.match(system, /first name given/);
    assert.match(system, /specific references the judges made intact/);
    assert.match(system, /nothing about culture/);
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
    const written = readOverall([{ id: "p1", positive: "Good.", constructive: " " }], [person(), person({ id: "p2" })]);
    assert.equal(written.size, 0);
  });
});

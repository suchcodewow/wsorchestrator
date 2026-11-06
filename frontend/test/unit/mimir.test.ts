/**
 * How Coach Canary sends a stored coach turn back to Claude, which every turn
 * of the map coach's conversation goes through.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { forReplay } from "@/lib/mimir/chat";

describe("replaying a coach turn", () => {
  test("is sent back exactly as it came, when no fallback happened", () => {
    const content = [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "Hi." }];
    assert.equal(forReplay(content), content);
    assert.equal(forReplay("An opener."), "An opener.");
  });

  test("after a mid-reply fallback, leaves out the declined model's thinking but keeps its text", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "a" },
      { type: "text", text: "Part one" },
      { type: "fallback", from: { model: "x" }, to: { model: "y" } },
      { type: "thinking", thinking: "", signature: "b" },
      { type: "text", text: " part two." },
    ];
    assert.deepEqual(
      (forReplay(content) as { type: string }[]).map((b) => b.type),
      ["text", "fallback", "thinking", "text"],
    );
  });
});

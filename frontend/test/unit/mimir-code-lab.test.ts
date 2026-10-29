/**
 * The Code Lab's pure parts: the line diff its commit and pull request show,
 * the highlighter its editor colours with, and how it tells the ticket's
 * tasks are done.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { diffHunks, diffStats, lineDiff } from "@/lib/mimir/code-lab/diff";
import { highlightHtml } from "@/lib/mimir/code-lab/highlight";
import { START_CODE, TASKS, cleanBranchName, fakeHash } from "@/lib/mimir/code-lab/scenario";

const task = (id: string) => TASKS.find((t) => t.id === id)!;

describe("lineDiff", () => {
  test("an unchanged file is all kept lines", () => {
    const lines = lineDiff("a\nb", "a\nb");
    assert.deepEqual(lines.map((l) => l.kind), ["same", "same"]);
    assert.deepEqual(diffStats(lines), { added: 0, removed: 0 });
  });

  test("a changed line reads as the old one removed, then the new one added", () => {
    const lines = lineDiff("a\nb\nc", "a\nB\nc");
    assert.deepEqual(
      lines.map((l) => `${l.kind}:${l.text}`),
      ["same:a", "del:b", "add:B", "same:c"],
    );
  });

  test("line numbers count from each side's own file", () => {
    const lines = lineDiff("a\nc", "a\nb\nc");
    assert.deepEqual(lines[1], { kind: "add", text: "b", newNo: 2 });
    assert.deepEqual(lines[2], { kind: "same", text: "c", oldNo: 2, newNo: 3 });
  });

  test("hunks keep two lines of context and drop the rest", () => {
    const before = Array.from({ length: 20 }, (_, k) => `line ${k}`).join("\n");
    const after = before.replace("line 3", "LINE 3").replace("line 16", "LINE 16");
    const hunks = diffHunks(lineDiff(before, after));
    assert.equal(hunks.length, 2);
    assert.deepEqual(
      hunks[0]!.map((l) => l.text),
      ["line 1", "line 2", "line 3", "LINE 3", "line 4", "line 5"],
    );
  });
});

describe("highlightHtml", () => {
  test("the tokens join back into the source, starting page included", () => {
    for (const src of [START_CODE, "<div class=\"x", "a < b", "<style>a { color: red", "<!-- open", ""]) {
      assert.equal(highlightHtml(src).map((t) => t.text).join(""), src);
    }
  });

  test("tags, attributes and strings are told apart", () => {
    const tokens = highlightHtml('<button class="cta">Go</button>');
    assert.deepEqual(
      tokens.map((t) => [t.kind, t.text]),
      [
        ["punct", "<"],
        ["tag", "button"],
        ["text", " "],
        ["attr", "class"],
        ["punct", "="],
        ["string", '"cta"'],
        ["punct", ">"],
        ["text", "Go"],
        ["punct", "</"],
        ["tag", "button"],
        ["punct", ">"],
      ],
    );
  });

  test("CSS in a style block gets selectors, properties and values", () => {
    const tokens = highlightHtml("<style>.cta { color: red; }</style>");
    const kinds = Object.fromEntries(tokens.filter((t) => t.text.trim()).map((t) => [t.text, t.kind]));
    assert.equal(kinds[".cta"], "selector");
    assert.equal(kinds.color, "prop");
    assert.equal(kinds.red, "value");
  });
});

describe("the ticket's tasks", () => {
  test("none is done on the starting page", () => {
    assert.deepEqual(TASKS.filter((t) => t.done(START_CODE)).map((t) => t.id), []);
  });

  test("each is done by the change its hint describes", () => {
    assert.ok(task("headline").done(START_CODE.replace("10% off", "20% off")));
    assert.ok(task("button-text").done(START_CODE.replace(">Shop now<", ">Shop the sale<")));
    assert.ok(task("button-colour").done(START_CODE.replace("--button: #2563eb", "--button: orange")));
  });

  test("20% elsewhere on the page doesn't count for the headline", () => {
    assert.ok(!task("headline").done(START_CODE.replace("this week only", "20% this week only")));
  });
});

describe("helpers", () => {
  test("a fake hash is seven hex digits and steady for the same seed", () => {
    assert.match(fakeHash("x"), /^[0-9a-f]{7}$/);
    assert.equal(fakeHash("x"), fakeHash("x"));
    assert.notEqual(fakeHash("x"), fakeHash("y"));
  });

  test("a branch name loses what git would refuse", () => {
    assert.equal(cleanBranchName("  my new branch "), "my-new-branch");
    assert.equal(cleanBranchName("/feature/a..b~1:"), "feature/a.b1");
    assert.equal(cleanBranchName("   "), "");
  });
});

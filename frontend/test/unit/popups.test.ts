/**
 * The two ways popups and modals have gone wrong here, caught before review:
 * a panel hung off its trigger with `top-full` (which runs off the bottom of
 * the screen or a dialog, where Floating UI would flip it), and a dialog
 * given its own surface, which in dark mode blends into the page. See
 * CLAUDE.md, "Every popup is placed by Floating UI" and "A modal is a
 * `DialogContent`".
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dirname, "../../src");
/** Where the primitives live; they may do as they like. */
const PRIMITIVES = join(SRC, "components/ui");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return path === PRIMITIVES ? [] : sources(path);
    return /\.tsx?$/.test(e.name) ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));

describe("popups", () => {
  test("none hangs off its trigger with top-full or bottom-full", () => {
    const wrong = files.filter((f) => /\b(?:top|bottom)-full\b/.test(f.text)).map((f) => f.path);
    assert.deepEqual(wrong, [], "place it with anchorFloating or useAnchoredToParent instead");
  });
});

describe("modals", () => {
  test("no DialogContent is given a background, border or shadow of its own", () => {
    const wrong: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/<DialogContent\b[^>]*?className="([^"]*)"/gs)) {
        const own = m[1]!.split(/\s+/).filter((c) => /^(?:dark:)?(?:bg-|border-(?!0)|shadow|ring-)/.test(c));
        if (own.length) wrong.push(`${f.path}: ${own.join(" ")}`);
      }
    }
    assert.deepEqual(wrong, [], "DialogContent owns its surface, edge and shadow");
  });
});

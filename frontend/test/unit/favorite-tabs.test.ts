/** What may be saved as a favorite tab: in-app links with a label, 25 at most. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { MAX_FAVORITE_TABS, parseFavoriteTabs } from "@/lib/favorite-tabs";

describe("parseFavoriteTabs", () => {
  test("keeps in-app links in order, trimming labels and dropping repeats", () => {
    assert.deepEqual(
      parseFavoriteTabs([
        { href: "/mimir/map", label: " Map " },
        { href: "/settings/people", label: "People" },
        { href: "/mimir/map", label: "Map again" },
      ]),
      [
        { href: "/mimir/map", label: "Map" },
        { href: "/settings/people", label: "People" },
      ],
    );
  });

  test("accepts an empty list", () => {
    assert.deepEqual(parseFavoriteTabs([]), []);
  });

  test("rejects anything that is not an in-app link with a label", () => {
    for (const bad of [
      null,
      "x",
      [null],
      [{ href: "https://evil.example", label: "x" }],
      [{ href: "//evil.example", label: "x" }],
      [{ href: "mimir", label: "x" }],
      [{ href: "/a b", label: "x" }],
      [{ href: "/a", label: "  " }],
      [{ href: "/a", label: "x".repeat(81) }],
      [{ href: "/a" }],
    ]) {
      assert.equal(parseFavoriteTabs(bad), null, JSON.stringify(bad));
    }
  });

  test("rejects more than the limit", () => {
    const many = Array.from({ length: MAX_FAVORITE_TABS + 1 }, (_, i) => ({ href: `/t${i}`, label: "t" }));
    assert.equal(parseFavoriteTabs(many), null);
  });
});

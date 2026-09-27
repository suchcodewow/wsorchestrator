/**
 * `cn` and `isUuid`, used all over.
 *
 * `isUuid` guards route params before they reach a `uuid` column: Postgres
 * rejects a malformed uuid with an error rather than returning no rows, so a
 * path like `/runs/not-a-run` would be a 500 instead of a 404 without it.
 * `cn` is pinned for the one behaviour components rely on — a later Tailwind
 * class overrides an earlier conflicting one.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { cn, isUuid } from "@/lib/utils";

describe("isUuid", () => {
  test("accepts a canonical uuid in either case", () => {
    assert.equal(isUuid("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), true);
    assert.equal(isUuid("3F2504E0-4F89-11D3-9A0C-0305E82C3301"), true);
    assert.equal(isUuid(crypto.randomUUID()), true);
    assert.equal(isUuid("00000000-0000-0000-0000-000000000000"), true);
  });

  test("rejects anything else", () => {
    for (const v of [
      "",
      "not-a-run",
      "3f2504e04f8911d39a0c0305e82c3301",
      "{3f2504e0-4f89-11d3-9a0c-0305e82c3301}",
      " 3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301\n",
      "3f2504e0-4f89-11d3-9a0c-0305e82c330",
      "3f2504e0-4f89-11d3-9a0c-0305e82c33011",
      "3f2504e0-4f89-11d3-9a0c-0305e82c330g",
      "3f2504e0_4f89_11d3_9a0c_0305e82c3301",
    ]) {
      assert.equal(isUuid(v), false, JSON.stringify(v));
    }
  });
});

describe("cn", () => {
  test("joins class names and drops falsy ones", () => {
    assert.equal(cn("a", false, null, undefined, "", "b"), "a b");
    assert.equal(cn(), "");
  });

  test("accepts conditional objects and arrays", () => {
    assert.equal(cn("a", { b: true, c: false }, ["d", ["e"]]), "a b d e");
  });

  test("a later conflicting Tailwind class wins", () => {
    assert.equal(cn("p-2", "p-4"), "p-4");
    assert.equal(cn("text-sm text-red-500", "text-blue-500"), "text-sm text-blue-500");
    assert.equal(cn("px-2 py-1", "p-3"), "p-3");
  });

  test("non-conflicting classes are all kept", () => {
    assert.equal(cn("p-2", "m-2", "text-sm"), "p-2 m-2 text-sm");
  });
});

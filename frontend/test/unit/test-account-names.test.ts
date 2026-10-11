/**
 * The names a new test account starts with: a hundred characters, each one
 * a valid test account name, and a pick that never repeats one already taken.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { TEST_ACCOUNT_LIMITS } from "@/db/schema";
import { CHARACTER_NAMES, pickCharacterName } from "@/lib/test-account-names";

describe("CHARACTER_NAMES", () => {
  test("is a hundred different names", () => {
    assert.equal(CHARACTER_NAMES.length, 100);
    assert.equal(new Set(CHARACTER_NAMES.map((n) => n.toLowerCase())).size, 100);
  });

  test("each fits a test account's name", () => {
    for (const name of CHARACTER_NAMES) {
      assert.equal(name, name.trim());
      assert.ok(name.length > 0 && name.length <= TEST_ACCOUNT_LIMITS.name, name);
    }
  });
});

describe("pickCharacterName", () => {
  test("with nothing taken, can be any of them", () => {
    assert.equal(pickCharacterName([], () => 0), CHARACTER_NAMES[0]);
    assert.equal(pickCharacterName([], () => 0.999999), CHARACTER_NAMES.at(-1));
  });

  test("never picks a taken name, whatever its case or spacing", () => {
    const [kept, ...rest] = CHARACTER_NAMES;
    const taken = rest.map((n, i) => (i % 2 ? `  ${n.toUpperCase()} ` : n));
    for (const r of [0, 0.5, 0.999999]) assert.equal(pickCharacterName(taken, () => r), kept);
  });

  test("is null once every name is taken", () => {
    assert.equal(pickCharacterName(CHARACTER_NAMES), null);
  });

  test("ignores names that aren't characters'", () => {
    assert.ok(pickCharacterName(["Iris tester", "e2e"]));
  });
});

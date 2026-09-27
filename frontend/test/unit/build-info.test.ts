/**
 * Which build is running, as the footer shows it.
 *
 * It is how anyone answers "is my fix live yet?", and it is fed by three
 * environment variables that pass through Cloud Build substitutions, Harness
 * build args and a shell on the way in. The commit subject travels base64
 * precisely because subjects here contain commas, apostrophes and backticks
 * that one of those layers would split or evaluate on. The rule pinned below
 * is that nothing a mangled variable can hold turns the page into a 500: a
 * missing or garbled value degrades to "dev" or null.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildInfo } from "@/lib/build-info";

const KEYS = ["BUILD_TAG", "BUILD_TIME", "BUILD_MESSAGE_B64"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("tag", () => {
  test("is dev when unset or blank", () => {
    assert.equal(buildInfo().tag, "dev");
    process.env.BUILD_TAG = "   ";
    assert.equal(buildInfo().tag, "dev");
  });

  test("is the trimmed value when set", () => {
    process.env.BUILD_TAG = "  bccf75c \n";
    assert.equal(buildInfo().tag, "bccf75c");
  });
});

describe("build time", () => {
  test("is null when unset, blank or not a date", () => {
    for (const v of [undefined, "", "  ", "yesterday", "2026-13-45T99:99:99Z"]) {
      if (v === undefined) delete process.env.BUILD_TIME;
      else process.env.BUILD_TIME = v;
      const info = buildInfo();
      assert.equal(info.builtAt, null, String(v));
      assert.equal(info.builtAtLabel, null, String(v));
    }
  });

  test("is normalised to ISO and labelled in UTC", () => {
    process.env.BUILD_TIME = "2026-09-27T14:05:09Z";
    const info = buildInfo();
    assert.equal(info.builtAt, "2026-09-27T14:05:09.000Z");
    // ICU spells September "Sep" or "Sept" depending on version.
    assert.match(info.builtAtLabel!, /^27 Sept? 2026, 14:05 UTC$/);
  });

  test("an offset timestamp is converted to UTC, not shown in its own zone", () => {
    process.env.BUILD_TIME = "2026-09-27T23:30:00-02:00";
    const info = buildInfo();
    assert.equal(info.builtAt, "2026-09-28T01:30:00.000Z");
    assert.match(info.builtAtLabel!, /^28 Sept? 2026, 01:30 UTC$/);
  });

  test("midnight is 00, not 24", () => {
    process.env.BUILD_TIME = "2026-01-02T00:07:00Z";
    assert.equal(buildInfo().builtAtLabel, "2 Jan 2026, 00:07 UTC");
  });

  test("an invalid time does not take the tag or message with it", () => {
    process.env.BUILD_TAG = "abc123";
    process.env.BUILD_MESSAGE_B64 = b64("Fix it");
    process.env.BUILD_TIME = "not a date";
    assert.deepEqual(buildInfo(), { tag: "abc123", builtAt: null, builtAtLabel: null, message: "Fix it" });
  });
});

describe("commit message", () => {
  test("is null when unset or blank", () => {
    assert.equal(buildInfo().message, null);
    process.env.BUILD_MESSAGE_B64 = "  ";
    assert.equal(buildInfo().message, null);
  });

  test("survives the characters that motivated encoding it", () => {
    const subject = "Don't split on commas, `backticks` or $(subshells); \"quotes\" too";
    process.env.BUILD_MESSAGE_B64 = b64(subject);
    assert.equal(buildInfo().message, subject);
  });

  test("decodes UTF-8", () => {
    process.env.BUILD_MESSAGE_B64 = b64("Café — naïve résumé ✓");
    assert.equal(buildInfo().message, "Café — naïve résumé ✓");
  });

  test("collapses newlines and runs of whitespace into single spaces", () => {
    process.env.BUILD_MESSAGE_B64 = b64("  Update harness.ts\n\n  body line\t two  ");
    assert.equal(buildInfo().message, "Update harness.ts body line two");
  });

  test("an encoding of only whitespace is null", () => {
    process.env.BUILD_MESSAGE_B64 = b64(" \n\t ");
    assert.equal(buildInfo().message, null);
  });

  test("a value that is not base64 degrades instead of throwing", () => {
    for (const v of ["!!!!", "%%%", "@"]) {
      process.env.BUILD_MESSAGE_B64 = v;
      assert.doesNotThrow(() => buildInfo(), v);
      assert.equal(buildInfo().message, null, v);
    }
  });

  test("the surrounding whitespace a shell may add to the variable is ignored", () => {
    process.env.BUILD_MESSAGE_B64 = `  ${b64("Ship it")}\n`;
    assert.equal(buildInfo().message, "Ship it");
  });
});

test("reads the environment on every call", () => {
  process.env.BUILD_TAG = "one";
  assert.equal(buildInfo().tag, "one");
  process.env.BUILD_TAG = "two";
  assert.equal(buildInfo().tag, "two");
});

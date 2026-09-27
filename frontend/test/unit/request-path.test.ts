/**
 * `returnPath`: where a visitor is sent after signing in.
 *
 * Its input is attacker-controlled — the sign-in page reads it straight from
 * `?callbackUrl=` and a signed-in visitor is `redirect()`ed to it — so it is an
 * open-redirect guard. A phishing link to our real sign-in page that bounces a
 * signed-in attendee to a look-alike site is the failure it exists to prevent.
 *
 * The rule tested is the one that matters rather than the one implemented: an
 * accepted value, resolved by a browser against our origin, stays on our
 * origin. Browsers strip tab and newline from URLs and treat `\` as `/`, which
 * is how `/\t/evil.example` becomes `//evil.example`.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { REQUEST_PATH_HEADER, returnPath } from "@/lib/request-path";

const ORIGIN = "https://workshops.example";

/** Where a browser would land following a redirect to this value. */
const lands = (value: string) => new URL(value, ORIGIN).origin;

describe("returnPath", () => {
  test("keeps an ordinary path with its query and fragment", () => {
    for (const path of ["/", "/events", "/events/abc?tab=runs", "/lab-guides/setup#step-2", "/signinx", "/settings/signin"]) {
      assert.equal(returnPath(path), path);
    }
  });

  test("is null for nothing", () => {
    assert.equal(returnPath(null), null);
    assert.equal(returnPath(undefined), null);
    assert.equal(returnPath(""), null);
  });

  test("is null for anything that is not a same-site path", () => {
    for (const value of [
      "events",
      "https://evil.example",
      "http://evil.example/",
      "javascript:alert(1)",
      "//evil.example",
      "//evil.example/events",
      "/\\evil.example",
      " /events",
      "\\\\evil.example",
    ]) {
      assert.equal(returnPath(value), null, value);
    }
  });

  test("is null for sign-in itself, which would loop", () => {
    assert.equal(returnPath("/signin"), null);
    assert.equal(returnPath("/signin?callbackUrl=%2Fevents"), null);
  });

  test("every accepted value stays on our origin", () => {
    for (const value of [
      "/events",
      "/%2F%2Fevil.example",
      "/.//evil.example",
      "/@evil.example",
      "/events?next=//evil.example",
      "/events#//evil.example",
    ]) {
      const kept = returnPath(value);
      if (kept !== null) assert.equal(lands(kept), ORIGIN, value);
    }
  });

  test("a path the browser rewrites into another origin is refused", () => {
    // callbackUrl=%2F%09%2Fevil.example: the tab is stripped, leaving //evil.example.
    for (const value of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\t\\evil.example"]) {
      assert.equal(returnPath(value), null, JSON.stringify(value));
    }
  });

  test("the header name is lower-case, as Headers normalises it", () => {
    assert.equal(REQUEST_PATH_HEADER, REQUEST_PATH_HEADER.toLowerCase());
  });
});

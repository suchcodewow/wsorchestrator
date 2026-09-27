/**
 * The cookie that remembers whether the sidebar is collapsed.
 *
 * The server reads it to render the first frame at the right width, so a
 * value it cannot parse has to fall back to the default (expanded) rather than
 * to a half-state, and what the client writes has to be what the server reads.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { SIDEBAR_COOKIE, parseSidebarState, writeSidebarCookie } from "@/lib/sidebar";

describe("parseSidebarState", () => {
  test("collapsed only when the cookie says exactly that", () => {
    assert.equal(parseSidebarState("collapsed"), "collapsed");
  });

  test("everything else is expanded", () => {
    for (const v of [undefined, "", "expanded", "Collapsed", " collapsed", "true", "1"]) {
      assert.equal(parseSidebarState(v), "expanded", String(v));
    }
  });
});

describe("writeSidebarCookie", () => {
  const g = globalThis as { document?: unknown };
  let saved: unknown;
  beforeEach(() => {
    saved = g.document;
  });
  afterEach(() => {
    if (saved === undefined) delete g.document;
    else g.document = saved;
  });

  test("writes a year-long, site-wide cookie", () => {
    const doc = { cookie: "" };
    g.document = doc;
    writeSidebarCookie("collapsed");
    assert.equal(doc.cookie, `${SIDEBAR_COOKIE}=collapsed; path=/; max-age=31536000; samesite=lax`);
  });

  test("round-trips through parseSidebarState", () => {
    for (const state of ["collapsed", "expanded"] as const) {
      const doc = { cookie: "" };
      g.document = doc;
      writeSidebarCookie(state);
      const value = doc.cookie.split(";")[0]!.slice(`${SIDEBAR_COOKIE}=`.length);
      assert.equal(parseSidebarState(value), state);
    }
  });
});

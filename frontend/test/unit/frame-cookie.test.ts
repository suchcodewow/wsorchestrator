/**
 * When the proxy hands a framed page's session to Auth.js. The frame's cookie
 * is sent on every request to this app under the framing site, its own pages'
 * and the framing site's alike, so a change must be let through only from
 * this app's own pages.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { FRAME_SESSION_COOKIE, sentCrossSite, withFrameSession } from "@/lib/frame-cookie";

const FRAME = `${FRAME_SESSION_COOKIE}=tok123`;

function injected(method: string, init: Record<string, string>): string | null {
  const headers = new Headers(init);
  return withFrameSession(headers, method) ? headers.get("cookie") : null;
}

describe("withFrameSession", () => {
  test("adds the frame's session under both of Auth.js's names", () => {
    assert.equal(
      injected("GET", { cookie: `theme=dark; ${FRAME}`, "sec-fetch-site": "cross-site" }),
      `theme=dark; ${FRAME}; __Secure-authjs.session-token=tok123; authjs.session-token=tok123`,
    );
  });

  test("does nothing without the frame's cookie", () => {
    assert.equal(injected("GET", { cookie: "theme=dark" }), null);
    assert.equal(injected("GET", {}), null);
  });

  test("leaves an ordinary session alone", () => {
    assert.equal(injected("GET", { cookie: `authjs.session-token=mine; ${FRAME}` }), null);
    assert.equal(injected("GET", { cookie: `__Secure-authjs.session-token=mine; ${FRAME}` }), null);
  });

  test("lets a change through from this app's own pages", () => {
    assert.ok(injected("POST", { cookie: FRAME, "sec-fetch-site": "same-origin" }));
    assert.ok(injected("DELETE", { cookie: FRAME, origin: "https://app.example", host: "app.example" }));
    assert.ok(
      injected("PATCH", { cookie: FRAME, origin: "https://app.example", host: "internal:8080", "x-forwarded-host": "app.example" }),
    );
  });

  test("refuses a change from anywhere else", () => {
    assert.equal(injected("POST", { cookie: FRAME, "sec-fetch-site": "cross-site" }), null);
    assert.equal(injected("POST", { cookie: FRAME, "sec-fetch-site": "same-site" }), null);
    assert.equal(injected("POST", { cookie: FRAME, origin: "https://evil.example", host: "app.example" }), null);
    assert.equal(injected("POST", { cookie: FRAME, origin: "null", host: "app.example" }), null);
    assert.equal(injected("POST", { cookie: FRAME, host: "app.example" }), null);
  });

  test("trusts Sec-Fetch-Site over a matching Origin", () => {
    assert.equal(
      injected("POST", { cookie: FRAME, "sec-fetch-site": "cross-site", origin: "https://app.example", host: "app.example" }),
      null,
    );
  });
});

describe("sentCrossSite", () => {
  test("is true only for a browser's request from another site", () => {
    assert.equal(sentCrossSite(new Headers({ "sec-fetch-site": "same-origin" })), false);
    assert.equal(sentCrossSite(new Headers()), false);
    assert.equal(sentCrossSite(new Headers({ "sec-fetch-site": "cross-site" })), true);
    assert.equal(sentCrossSite(new Headers({ "sec-fetch-site": "same-site" })), true);
  });
});

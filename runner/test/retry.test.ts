/**
 * The generic retry wrapper, which is what stands between a Google Workspace
 * hiccup and a failed workshop.
 *
 * Two behaviours here are load-bearing and neither is obvious from the outside:
 *
 *  - A *non*-transient error must come back out unchanged and immediately,
 *    because `directory.ts` reads its status to decide whether a user already
 *    exists. Wrapping it — even helpfully — turns "already created, carry on"
 *    into a failed run.
 *  - A Google front-end 5xx arrives as an HTML error page, not a JSON API error,
 *    so the status only exists inside the markup. Miss it and the retry never
 *    fires and the run dies with a page of HTML as its error message, which is
 *    how this module came to exist.
 *
 * The delays are driven down to zero so the suite stays in milliseconds; the
 * schedule itself is asserted through `onRetry` rather than by waiting for it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { httpStatusOf, isTransient, summarize, withRetry } from "../src/retry.js";

/** The shape gaxios hands back for an HTTP failure. */
const gaxiosError = (status: number, message = "request failed") =>
  Object.assign(new Error(message), { status, response: { status } });

/** The shape undici hands back for a socket failure: code lives on `cause`. */
const fetchError = (code: string) =>
  Object.assign(new TypeError("fetch failed"), { cause: { code } });

/** What Google's front end actually returns instead of a JSON error. */
const GOOGLE_502_PAGE =
  "<!DOCTYPE html><html lang=en><title>Error 502 (Server Error)!!1</title>" +
  "<p><b>502.</b> <ins>That's an error.</ins><p>The server encountered a " +
  "temporary error and could not complete your request. <a href=" +
  '"https://www.google.com">Google</a> home.';

describe("isTransient", () => {
  test("retries the statuses a second attempt can get past", () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      assert.equal(isTransient(gaxiosError(status)), true, `HTTP ${status}`);
    }
  });

  test("does not retry a refusal", () => {
    // 409 and 404 in particular: `directory.ts` depends on seeing these itself
    // to treat "already exists" and "already gone" as success.
    for (const status of [400, 401, 403, 404, 409, 412, 422]) {
      assert.equal(isTransient(gaxiosError(status)), false, `HTTP ${status}`);
    }
  });

  test("retries a socket failure hidden on `cause`", () => {
    // undici reports every network fault as `TypeError: fetch failed` with the
    // real code one level down, so checking only the error itself finds nothing.
    for (const code of ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"]) {
      assert.equal(isTransient(fetchError(code)), true, code);
    }
  });

  test("retries Google's HTML error page", () => {
    const err = Object.assign(new Error("failed"), {
      response: { data: GOOGLE_502_PAGE },
    });
    assert.equal(isTransient(err), true);
    assert.equal(httpStatusOf(err), 502, "the status is only in the markup");
  });

  test("does not mistake a socket code for an HTTP status", () => {
    // `code` carries both, so `Number("ECONNRESET")` must not become a status.
    assert.equal(httpStatusOf(fetchError("ECONNRESET")), undefined);
  });

  test("does not retry something that is not an error at all", () => {
    for (const value of [null, undefined, "nope", 42, {}]) {
      assert.equal(isTransient(value), false, JSON.stringify(value) ?? "undefined");
    }
  });
});

describe("summarize", () => {
  test("never returns a page of markup", () => {
    const err = Object.assign(new Error("failed"), {
      response: { data: GOOGLE_502_PAGE },
    });
    const text = summarize(err);
    assert.ok(!text.includes("<"), `still HTML: ${text}`);
    assert.match(text, /google/i, "should name whose fault it is");
    assert.match(text, /502/);
  });

  test("caps a runaway message", () => {
    const text = summarize(new Error("x".repeat(5000)));
    assert.ok(text.length <= 600, `${text.length} characters reaches the UI`);
  });

  test("collapses newlines, so a run log stays one line per event", () => {
    assert.equal(summarize(new Error("first\n\n  second")), "first second");
  });
});

describe("withRetry", () => {
  const noWait = { label: "test", baseDelayMs: 0 } as const;

  test("returns the first success without retrying", async () => {
    let calls = 0;
    const value = await withRetry(async () => {
      calls++;
      return "ok";
    }, noWait);
    assert.equal(value, "ok");
    assert.equal(calls, 1);
  });

  test("gets past a transient failure", async () => {
    let calls = 0;
    const value = await withRetry(async () => {
      if (++calls < 3) throw gaxiosError(503);
      return "ok";
    }, noWait);
    assert.equal(value, "ok");
    assert.equal(calls, 3);
  });

  test("rethrows a refusal unchanged and immediately", async () => {
    // The whole reason `directory.ts` can treat 409 as "already exists". If this
    // ever starts wrapping, every re-run of a grown workshop fails instead.
    const conflict = gaxiosError(409, "Entity already exists.");
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(async () => {
          calls++;
          throw conflict;
        }, noWait),
      (err: unknown) => {
        assert.equal(err, conflict, "must be the same error object");
        assert.equal(httpStatusOf(err), 409, "status must survive");
        return true;
      },
    );
    assert.equal(calls, 1, "a refusal must not be attempted twice");
  });

  test("gives up after the budget and blames the provider", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw gaxiosError(502);
          },
          { ...noWait, label: "Google Workspace Directory (create user)", attempts: 3 },
        ),
      (err: unknown) => {
        const message = (err as Error).message;
        assert.match(message, /Google Workspace Directory \(create user\)/);
        assert.match(message, /3 attempts/);
        // The organizer's actionable takeaway: it is not their configuration.
        assert.match(message, /provider's side/);
        return true;
      },
    );
    assert.equal(calls, 3);
  });

  test("backs off exponentially", async () => {
    const delays: number[] = [];
    await assert.rejects(() =>
      withRetry(
        async () => {
          throw gaxiosError(500);
        },
        {
          label: "test",
          baseDelayMs: 1,
          attempts: 4,
          onRetry: ({ delayMs }) => {
            delays.push(delayMs);
          },
        },
      ),
    );
    // Three waits for four attempts, doubling each time — and no wait after the
    // final attempt, which would be time spent going nowhere.
    assert.deepEqual(delays, [1, 2, 4]);
  });

  test("awaits onRetry, so log lines stay ordered", async () => {
    // `onRetry` writes to the run log; if it is not awaited the lines interleave
    // with whatever the next attempt writes and the log stops being readable.
    const order: string[] = [];
    await withRetry(
      async () => {
        order.push("attempt");
        if (order.filter((o) => o === "attempt").length < 2) throw gaxiosError(500);
        return "ok";
      },
      {
        label: "test",
        baseDelayMs: 0,
        onRetry: async () => {
          await new Promise((r) => setTimeout(r, 5));
          order.push("logged");
        },
      },
    );
    assert.deepEqual(order, ["attempt", "logged", "attempt"]);
  });
});

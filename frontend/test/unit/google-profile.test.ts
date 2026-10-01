/**
 * Telling a photo someone chose from the initial Google generates for an
 * account without one. The ID token's `picture` is set either way, so only the
 * People API's `default` flag can tell, and a sign-in must never wait on it or
 * fail because of it: every way that call can go wrong answers `null`, which
 * keeps the ID token's picture.
 */

import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { googlePhotoChosen, photoIsChosen } from "@/lib/google-profile";

const realFetch = globalThis.fetch;
const realWarn = console.warn;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
});

function respond(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status })) as typeof fetch;
  console.warn = () => {};
}

describe("photoIsChosen", () => {
  test("a user-provided photo is chosen", () => {
    assert.equal(
      photoIsChosen({ photos: [{ url: "u", default: false, metadata: { primary: true } }] }),
      true,
    );
  });

  test("Google's generated initial is not", () => {
    assert.equal(
      photoIsChosen({ photos: [{ url: "u", default: true, metadata: { primary: true } }] }),
      false,
    );
  });

  test("the primary photo decides, wherever it sits", () => {
    const body = {
      photos: [
        { url: "a", default: true },
        { url: "b", default: false, metadata: { primary: true } },
      ],
    };
    assert.equal(photoIsChosen(body), true);
  });

  test("an answer that does not say is null", () => {
    const noFlag = { photos: [{ url: "u", metadata: { primary: true } }] };
    for (const body of [null, {}, { photos: [] }, { photos: "nope" }, noFlag]) {
      assert.equal(photoIsChosen(body), null, JSON.stringify(body));
    }
  });
});

describe("googlePhotoChosen", () => {
  test("no access token asks nothing", async () => {
    globalThis.fetch = (() => assert.fail("fetched without a token")) as typeof fetch;
    assert.equal(await googlePhotoChosen(undefined), null);
  });

  test("reads the default flag from the People API", async () => {
    respond(200, { photos: [{ url: "u", default: true, metadata: { primary: true } }] });
    assert.equal(await googlePhotoChosen("token"), false);
  });

  test("the API being off in the project is null, not an error", async () => {
    respond(403, { error: { status: "PERMISSION_DENIED", message: "People API has not been used" } });
    assert.equal(await googlePhotoChosen("token"), null);
  });

  test("a network failure is null, not an error", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    console.warn = () => {};
    assert.equal(await googlePhotoChosen("token"), null);
  });
});

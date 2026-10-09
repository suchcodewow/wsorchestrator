/**
 * Cloud Storage V4 signed URLs, which participants' browsers upload chunks on
 * and administrators download recordings from. A mistake here only shows on
 * a real bucket — the emulator does not check signatures — as a 403 on every
 * upload, so it is pinned to what Google's own library produces.
 *
 * The expected values were taken from `generate_signed_url_v4` in
 * google-cloud-storage 2.18.2 for the same inputs, signed with the same
 * throwaway key: the URLs matched it character for character, signature and
 * all. The signature itself is RSA over `stringToSign`, so matching these two
 * is matching the URL.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { encodeObjectPath, encodeRfc3986, signingParts } from "@/lib/recording/gcs-sign";

const now = new Date("2026-10-09T15:30:00Z");
const email = "app-sa@p.iam.gserviceaccount.com";

describe("signingParts", () => {
  test("a download with its filename matches Google's library", () => {
    const parts = signingParts({
      method: "GET",
      host: "storage.googleapis.com",
      bucket: "recordings-bkt",
      object: "files/t-1/camera.mp4",
      email,
      now,
      expiresSeconds: 900,
      query: {
        "response-content-disposition": "attachment; filename*=UTF-8''Dana%20Smith%20-%20camera.mp4",
        "response-content-type": "video/mp4",
      },
    });
    assert.equal(
      parts.unsignedUrl,
      "/recordings-bkt/files/t-1/camera.mp4?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=app-sa%40p.iam.gserviceaccount.com%2F20261009%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20261009T153000Z&X-Goog-Expires=900&X-Goog-SignedHeaders=host&response-content-disposition=attachment%3B%20filename%2A%3DUTF-8%27%27Dana%2520Smith%2520-%2520camera.mp4&response-content-type=video%2Fmp4",
    );
    assert.equal(
      parts.stringToSign,
      "GOOG4-RSA-SHA256\n20261009T153000Z\n20261009/auto/storage/goog4_request\nd9ed369e4445c88496296f14001b22c9fb5a4fd62b48e58354a02fb5e70627d5",
    );
  });

  test("an upload names the method and expiry it is for", () => {
    const parts = signingParts({
      method: "PUT",
      host: "storage.googleapis.com",
      bucket: "recordings-bkt",
      object: "chunks/t-1/camera/000007",
      email,
      now,
      expiresSeconds: 3600,
    });
    assert.match(parts.unsignedUrl, /^\/recordings-bkt\/chunks\/t-1\/camera\/000007\?X-Goog-Algorithm=GOOG4-RSA-SHA256&/);
    assert.match(parts.unsignedUrl, /X-Goog-Expires=3600&X-Goog-SignedHeaders=host$/);
    // The method is part of what is signed: a download URL must never take an upload.
    const asGet = signingParts({ method: "GET", host: "storage.googleapis.com", bucket: "recordings-bkt", object: "chunks/t-1/camera/000007", email, now, expiresSeconds: 3600 });
    assert.notEqual(parts.stringToSign, asGet.stringToSign);
  });
});

describe("encoding", () => {
  test("RFC 3986 encodes what encodeURIComponent leaves alone", () => {
    assert.equal(encodeRfc3986("a!b'c(d)e*f"), "a%21b%27c%28d%29e%2Af");
  });

  test("an object path keeps its slashes and encodes each segment", () => {
    assert.equal(encodeObjectPath("files/a b/c+d.mp4"), "files/a%20b/c%2Bd.mp4");
  });
});

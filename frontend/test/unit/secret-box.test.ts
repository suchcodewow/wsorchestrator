/**
 * Sealing and opening stored secrets: Harness API tokens and org secrets, kept
 * in Postgres as AES-256-GCM blobs.
 *
 * What matters is what `openSecret` refuses. A blob that has been altered,
 * truncated, sealed under another key or written by a future format version
 * must come back as null — never as garbage plaintext that is then sent to
 * Harness as a token, and never as a throw that turns a settings page into a
 * 500. The runner opens the same blobs with its own copy of this code
 * (`runner/src/secret-box.ts`), so the layout — version byte, 12-byte IV,
 * 16-byte tag, body — is pinned here too.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { openSecret, sealSecret, secretsConfigured } from "@/lib/secret-box";

const KEYS = ["HARNESS_TOKEN_ENC_KEY", "AUTH_SECRET"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.HARNESS_TOKEN_ENC_KEY = "test-key-one";
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const HEADER = 1 + 12 + 16;

describe("round trip", () => {
  test("opens what it sealed", () => {
    const token = "pat.abc123.def456.ghi789";
    assert.equal(openSecret(sealSecret(token)), token);
  });

  test("handles the empty string, unicode, and large values", () => {
    for (const s of ["", "é ✓ 日本 🚀", "x".repeat(256 * 1024), '{"type":"service_account"}\n']) {
      assert.equal(openSecret(sealSecret(s)), s);
    }
  });

  test("the same plaintext seals differently every time", () => {
    const a = sealSecret("same");
    const b = sealSecret("same");
    assert.notDeepEqual(a, b);
    assert.notDeepEqual(a.subarray(1, 13), b.subarray(1, 13), "IVs must not repeat");
  });

  test("the plaintext does not appear in the blob", () => {
    const blob = sealSecret("very-recognisable-secret");
    assert.equal(blob.includes(Buffer.from("very-recognisable-secret")), false);
  });
});

describe("layout", () => {
  test("is version 1, then a 12-byte IV and 16-byte tag, then a body as long as the plaintext", () => {
    const blob = sealSecret("hello");
    assert.equal(blob[0], 1);
    assert.equal(blob.length, HEADER + Buffer.byteLength("hello"));
    assert.equal(sealSecret("").length, HEADER);
    assert.equal(sealSecret("é").length, HEADER + 2);
  });
});

describe("refusals", () => {
  test("anything shorter than the header is null", () => {
    const blob = sealSecret("");
    for (let n = 0; n < HEADER; n++) {
      assert.equal(openSecret(blob.subarray(0, n)), null, `length ${n}`);
    }
    assert.equal(openSecret(Buffer.alloc(0)), null);
  });

  test("an unknown version byte is null", () => {
    const blob = sealSecret("hello");
    for (const v of [0, 2, 255]) {
      const copy = Buffer.from(blob);
      copy[0] = v;
      assert.equal(openSecret(copy), null, `version ${v}`);
    }
  });

  test("a flipped bit anywhere after the version byte is null", () => {
    const blob = sealSecret("hello world");
    for (let i = 1; i < blob.length; i++) {
      const copy = Buffer.from(blob);
      copy[i] = copy[i]! ^ 0x01;
      assert.equal(openSecret(copy), null, `byte ${i}`);
    }
  });

  test("a truncated or extended body is null", () => {
    const blob = sealSecret("hello world");
    assert.equal(openSecret(blob.subarray(0, blob.length - 1)), null);
    assert.equal(openSecret(Buffer.concat([blob, Buffer.from([0])])), null);
  });

  test("a blob sealed under another key is null, not garbage", () => {
    const blob = sealSecret("hello");
    process.env.HARNESS_TOKEN_ENC_KEY = "test-key-two";
    assert.equal(openSecret(blob), null);
    process.env.HARNESS_TOKEN_ENC_KEY = "test-key-one";
    assert.equal(openSecret(blob), "hello");
  });

  test("random bytes of a plausible length are null", () => {
    const junk = Buffer.alloc(64, 7);
    junk[0] = 1;
    assert.equal(openSecret(junk), null);
  });
});

describe("key material", () => {
  test("falls back to AUTH_SECRET when HARNESS_TOKEN_ENC_KEY is unset", () => {
    delete process.env.HARNESS_TOKEN_ENC_KEY;
    process.env.AUTH_SECRET = "auth-secret";
    const blob = sealSecret("hello");
    assert.equal(openSecret(blob), "hello");
  });

  test("HARNESS_TOKEN_ENC_KEY takes precedence over AUTH_SECRET", () => {
    process.env.AUTH_SECRET = "auth-secret";
    const blob = sealSecret("hello");
    delete process.env.HARNESS_TOKEN_ENC_KEY;
    assert.equal(openSecret(blob), null, "opened with AUTH_SECRET, so the dedicated key was ignored");
  });

  test("sealing with no key material throws a message naming both variables", () => {
    delete process.env.HARNESS_TOKEN_ENC_KEY;
    assert.throws(() => sealSecret("x"), /HARNESS_TOKEN_ENC_KEY or AUTH_SECRET/);
  });

  test("opening with no key material is null, not a throw", () => {
    const blob = sealSecret("hello");
    delete process.env.HARNESS_TOKEN_ENC_KEY;
    assert.equal(openSecret(blob), null);
  });

  test("secretsConfigured reflects whether either variable is set", () => {
    assert.equal(secretsConfigured(), true);
    delete process.env.HARNESS_TOKEN_ENC_KEY;
    assert.equal(secretsConfigured(), false);
    process.env.AUTH_SECRET = "a";
    assert.equal(secretsConfigured(), true);
  });

  test("an empty HARNESS_TOKEN_ENC_KEY falls back to AUTH_SECRET", () => {
    process.env.HARNESS_TOKEN_ENC_KEY = "";
    process.env.AUTH_SECRET = "auth-secret";
    assert.equal(secretsConfigured(), true);
    assert.equal(openSecret(sealSecret("hello")), "hello");
  });
});

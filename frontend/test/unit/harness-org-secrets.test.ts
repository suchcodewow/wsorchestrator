/**
 * The org secrets a workshop's Harness organization is given: what they may be
 * called, and how the settings form that uploads one is read.
 *
 * `identifierValid` is the name the secret gets in Harness, and pipelines refer
 * to it as `<+secrets.getValue("org.NAME")>` — so it must satisfy Harness's own
 * identifier rule, or the deploy fails on the secret long after it was saved.
 * `readOrgSecretForm` is the only thing between an uploaded file and the
 * encrypted column: it must refuse an empty file, one over the size limit, and
 * one that is not text (a binary keyfile would be stored as mojibake and hand
 * every attendee a credential that silently does not work).
 *
 * The functions that read or write the database are not exercised here.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ORG_SECRET_LIMITS } from "@/db/schema";
import { STATUS_FOR, identifierValid, readOrgSecretForm, type OrgSecretError } from "@/lib/harness-org-secrets";

/** Harness's own rule for an entity identifier, which also allows hyphens here. */
const HARNESS_SECRET_IDENTIFIER = /^[a-zA-Z_][0-9a-zA-Z_$-]{0,127}$/;

function form(fields: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const file = (content: BlobPart[], name = "key.pem") => new File(content, name);

describe("identifierValid", () => {
  test("accepts identifiers Harness accepts", () => {
    for (const ok of ["aws_access_key", "A", "_x", "gcp-sa-key", "token$2", "a".repeat(128)]) {
      assert.equal(identifierValid(ok), true, ok);
      assert.match(ok, HARNESS_SECRET_IDENTIFIER);
    }
  });

  test("ignores surrounding whitespace", () => {
    assert.equal(identifierValid("  aws_key \n"), true);
  });

  test("rejects a leading digit, $ or hyphen", () => {
    for (const bad of ["1key", "$key", "-key"]) assert.equal(identifierValid(bad), false, bad);
  });

  test("rejects spaces, dots and other punctuation", () => {
    for (const bad of ["aws key", "aws.key", "aws/key", "aws:key", "ключ", "a+b"]) {
      assert.equal(identifierValid(bad), false, bad);
    }
  });

  test("rejects empty input and anything over the 128-character limit", () => {
    assert.equal(ORG_SECRET_LIMITS.identifier, 128);
    assert.equal(identifierValid(""), false);
    assert.equal(identifierValid("   "), false);
    assert.equal(identifierValid("a".repeat(129)), false);
  });
});

describe("STATUS_FOR", () => {
  test("is exactly the specified status for every code", () => {
    const expected: Record<OrgSecretError, number> = {
      invalid_identifier: 400,
      empty: 400,
      malformed: 400,
      duplicate: 409,
      too_large: 413,
      binary: 415,
      not_found: 404,
      no_key: 503,
    };
    assert.deepEqual(STATUS_FOR, expected);
  });
});

describe("readOrgSecretForm", () => {
  describe("a text secret", () => {
    test("is read as typed, identifier included", async () => {
      assert.deepEqual(
        await readOrgSecretForm(form({ identifier: "aws_key", kind: "text", value: "AKIA..." })),
        { ok: true, identifier: "aws_key", input: { kind: "text", value: "AKIA..." } },
      );
    });

    test("keeps the value's whitespace, which may be part of the secret", async () => {
      const result = await readOrgSecretForm(form({ identifier: "k", kind: "text", value: "  a b \n" }));
      assert.equal(result.ok && result.input.value, "  a b \n");
    });

    test("passes an empty value through for the save step to refuse", async () => {
      // `seal` owns the empty and size checks for text, so the form reader
      // does not second-guess it.
      const result = await readOrgSecretForm(form({ identifier: "k", kind: "text", value: "" }));
      assert.deepEqual(result, { ok: true, identifier: "k", input: { kind: "text", value: "" } });
    });

    test("is malformed with no value, or with a file where the value should be", async () => {
      assert.deepEqual(await readOrgSecretForm(form({ identifier: "k", kind: "text" })), {
        ok: false,
        error: "malformed",
      });
      assert.deepEqual(
        await readOrgSecretForm(form({ identifier: "k", kind: "text", value: file(["x"]) })),
        { ok: false, error: "malformed" },
      );
    });
  });

  describe("a file secret", () => {
    test("is read as UTF-8 text with its file name", async () => {
      const pem = "-----BEGIN KEY-----\nabc\n-----END KEY-----\n";
      assert.deepEqual(
        await readOrgSecretForm(form({ identifier: "gcp_sa", kind: "file", file: file([pem], "sa.json") })),
        { ok: true, identifier: "gcp_sa", input: { kind: "file", value: pem, fileName: "sa.json" } },
      );
    });

    test("accepts multi-byte UTF-8", async () => {
      const result = await readOrgSecretForm(form({ identifier: "k", kind: "file", file: file(["café ✓"]) }));
      assert.equal(result.ok && result.input.value, "café ✓");
    });

    test("is empty for a zero-byte file", async () => {
      assert.deepEqual(await readOrgSecretForm(form({ identifier: "k", kind: "file", file: file([]) })), {
        ok: false,
        error: "empty",
      });
    });

    test("accepts a file exactly at the size limit and refuses one byte more", async () => {
      const at = await readOrgSecretForm(
        form({ identifier: "k", kind: "file", file: file(["a".repeat(ORG_SECRET_LIMITS.bytes)]) }),
      );
      assert.equal(at.ok, true);
      const over = await readOrgSecretForm(
        form({ identifier: "k", kind: "file", file: file(["a".repeat(ORG_SECRET_LIMITS.bytes + 1)]) }),
      );
      assert.deepEqual(over, { ok: false, error: "too_large" });
    });

    test("measures the limit in bytes, not characters", async () => {
      // "é" is two bytes, so half the limit in characters is exactly the limit.
      const at = await readOrgSecretForm(
        form({ identifier: "k", kind: "file", file: file(["é".repeat(ORG_SECRET_LIMITS.bytes / 2)]) }),
      );
      assert.equal(at.ok, true);
      const over = await readOrgSecretForm(
        form({ identifier: "k", kind: "file", file: file(["é".repeat(ORG_SECRET_LIMITS.bytes / 2), "a"]) }),
      );
      assert.deepEqual(over, { ok: false, error: "too_large" });
    });

    test("is binary for bytes that are not valid UTF-8", async () => {
      for (const bytes of [
        [0xff, 0xfe, 0x00, 0x01],
        [0x30, 0x82, 0x04, 0xa4, 0x02, 0x01], // the start of a DER-encoded key
        [0xc3], // a truncated two-byte sequence
      ]) {
        assert.deepEqual(
          await readOrgSecretForm(form({ identifier: "k", kind: "file", file: file([new Uint8Array(bytes)]) })),
          { ok: false, error: "binary" },
          JSON.stringify(bytes),
        );
      }
    });

    test("is malformed with no file, or with text where the file should be", async () => {
      assert.deepEqual(await readOrgSecretForm(form({ identifier: "k", kind: "file" })), {
        ok: false,
        error: "malformed",
      });
      assert.deepEqual(await readOrgSecretForm(form({ identifier: "k", kind: "file", file: "not a file" })), {
        ok: false,
        error: "malformed",
      });
    });
  });

  test("is malformed for a missing or unknown kind", async () => {
    for (const kind of [undefined, "", "TEXT", "File", "binary"]) {
      const fields: Record<string, string> = { identifier: "k", value: "v" };
      if (kind !== undefined) fields.kind = kind;
      assert.deepEqual(await readOrgSecretForm(form(fields)), { ok: false, error: "malformed" }, String(kind));
    }
  });

  test("passes the identifier through untouched for the save step to validate", async () => {
    const missing = await readOrgSecretForm(form({ kind: "text", value: "v" }));
    assert.equal(missing.ok && missing.identifier, "");
    const bad = await readOrgSecretForm(form({ identifier: " not valid ", kind: "text", value: "v" }));
    assert.equal(bad.ok && bad.identifier, " not valid ");
  });
});

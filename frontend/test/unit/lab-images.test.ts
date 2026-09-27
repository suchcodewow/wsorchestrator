/**
 * The lab image library: what an upload is allowed to be.
 *
 * Images are served back from our own origin at `/api/lab-images/<id>` with the
 * stored MIME type, so the type is decided by sniffing the bytes rather than
 * trusting the filename or the browser's claim. An SVG or an HTML file that got
 * through as `image/png` — or as itself — would run script on our origin for
 * every attendee whose guide shows it. `sniffImageType` is that gate, and these
 * tests feed it real magic numbers and near-misses.
 *
 * Also pinned: the size and emptiness checks that run before sniffing, and that
 * a malformed id is answered without a query (the pool is replaced with one that
 * fails the test if touched). Listing, inserting and renaming need a database
 * and are not tested here.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { pool } from "@/db";
import { LAB_IMAGE_LIMITS, LAB_IMAGE_MIME_TYPES } from "@/db/schema";
import {
  deleteLabImage,
  getLabImageData,
  missingLabImages,
  renameLabImage,
  sniffImageType,
  uploadLabImage,
} from "@/lib/lab-images";

const p = pool as unknown as Record<string, unknown>;
const saved = { connect: p.connect, query: p.query };
before(() => {
  p.connect = () => {
    throw new Error("the test reached the database");
  };
  p.query = p.connect;
});
after(() => {
  p.connect = saved.connect;
  p.query = saved.query;
});

const ID = "11111111-1111-4111-8111-111111111111";

/** Magic bytes, padded out past the 12 the sniffer needs. */
const bytes = (head: number[] | string, total = 32) => {
  const start = typeof head === "string" ? Buffer.from(head, "latin1") : Buffer.from(head);
  return Buffer.concat([start, Buffer.alloc(Math.max(0, total - start.length))]);
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const webp = (tag = "WEBP") => Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from(tag), Buffer.alloc(20)]);

describe("sniffImageType", () => {
  test("recognises each accepted type by its signature", () => {
    assert.equal(sniffImageType(bytes(PNG)), "image/png");
    assert.equal(sniffImageType(bytes(JPEG)), "image/jpeg");
    assert.equal(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xdb])), "image/jpeg");
    assert.equal(sniffImageType(bytes("GIF87a")), "image/gif");
    assert.equal(sniffImageType(bytes("GIF89a")), "image/gif");
    assert.equal(sniffImageType(webp()), "image/webp");
  });

  test("returns only types the library stores", () => {
    const found = [bytes(PNG), bytes(JPEG), bytes("GIF89a"), webp()].map(sniffImageType);
    for (const type of found) assert.ok(LAB_IMAGE_MIME_TYPES.includes(type!), String(type));
  });

  test("refuses script-bearing formats, however they start", () => {
    for (const text of [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
      "<!DOCTYPE html><script>alert(1)</script>",
      "<html><body>hi</body></html>",
      "﻿<svg></svg>",
    ]) {
      assert.equal(sniffImageType(Buffer.from(text)), null, text);
    }
  });

  test("refuses a PNG signature with any byte wrong", () => {
    for (let i = 0; i < PNG.length; i++) {
      const sig = [...PNG];
      sig[i] ^= 0x01;
      assert.equal(sniffImageType(bytes(sig)), null, `byte ${i}`);
    }
  });

  test("refuses near-miss signatures", () => {
    assert.equal(sniffImageType(bytes([0xff, 0xd8, 0x00])), null, "two-byte JPEG");
    assert.equal(sniffImageType(bytes("GIF88a")), null, "GIF88a");
    assert.equal(sniffImageType(bytes("gif89a")), null, "lower-case gif");
    assert.equal(sniffImageType(webp("WAVE")), null, "RIFF WAVE audio");
    assert.equal(sniffImageType(webp("AVI ")), null, "RIFF AVI video");
    assert.equal(sniffImageType(bytes("%PDF-1.7")), null, "PDF");
    assert.equal(sniffImageType(bytes([0x42, 0x4d])), null, "BMP");
  });

  test("refuses anything shorter than 12 bytes, even with a valid start", () => {
    assert.equal(sniffImageType(Buffer.alloc(0)), null);
    assert.equal(sniffImageType(bytes(PNG, 11)), null);
    assert.equal(sniffImageType(bytes(PNG, 12)), "image/png");
  });

  test("works on a slice of a larger buffer", () => {
    const whole = Buffer.concat([Buffer.from("junk"), bytes(PNG)]);
    assert.equal(sniffImageType(whole.subarray(4)), "image/png");
  });
});

describe("uploadLabImage checks before storing", () => {
  const upload = (data: Buffer) => uploadLabImage({ name: "n", alt: "a", data, authorId: "u" });

  test("refuses an empty file", async () => {
    assert.deepEqual(await upload(Buffer.alloc(0)), { ok: false, error: "empty" });
  });

  test("refuses a file over the size limit, before looking at it", async () => {
    const big = Buffer.concat([bytes(PNG), Buffer.alloc(LAB_IMAGE_LIMITS.bytes)]);
    assert.deepEqual(await upload(big), { ok: false, error: "too_large" });
  });

  test("refuses a file that is not an accepted image", async () => {
    assert.deepEqual(await upload(Buffer.from("<svg onload=alert(1)></svg>")), {
      ok: false,
      error: "unsupported_type",
    });
  });
});

describe("a malformed id never reaches the database", () => {
  for (const id of ["", "x", "../../etc/passwd", `${ID}.png`, "' or 1=1 --"]) {
    test(JSON.stringify(id), async () => {
      assert.equal(await getLabImageData(id), null);
      assert.equal(await deleteLabImage(id), false);
      assert.equal(await renameLabImage(id, "new name"), null);
    });
  }

  test("missingLabImages ignores ids that could not be images", async () => {
    assert.deepEqual(await missingLabImages([]), []);
    assert.deepEqual(await missingLabImages(["", "nope", `${ID} `]), []);
  });

  test("renaming to a blank name is refused without a query", async () => {
    assert.equal(await renameLabImage(ID, "   "), null);
    assert.equal(await renameLabImage(ID, ""), null);
  });
});

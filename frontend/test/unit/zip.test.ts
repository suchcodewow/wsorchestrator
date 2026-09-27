/**
 * The hand-rolled ZIP writer behind the contributor bundle download.
 *
 * It is ~90 lines of byte offsets written without a library, and the only
 * symptom of an off-by-one is an archive that some unzip tools open and others
 * call corrupt. So these tests read the archive back independently — walking
 * the end record, the central directory and each local header, inflating with
 * `zlib` and checking each CRC against `zlib.crc32` — rather than trusting the
 * writer's own view of what it wrote.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { crc32, inflateRawSync } from "node:zlib";

import { zip, type ZipEntry } from "@/lib/zip";

type Read = {
  path: string;
  content: string;
  flags: number;
  method: number;
  date: number;
  crc: number;
};

/** An independent reader: trusts only the end record, then cross-checks. */
function unzip(buf: Buffer): Read[] {
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50, "end of central directory signature");
  const count = buf.readUInt16LE(end + 10);
  assert.equal(buf.readUInt16LE(end + 8), count, "entries on this disk");
  const size = buf.readUInt32LE(end + 12);
  const start = buf.readUInt32LE(end + 16);
  assert.equal(start + size, end, "central directory ends where the end record starts");

  const out: Read[] = [];
  let p = start;
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, `central header ${i}`);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const compressed = buf.readUInt32LE(p + 20);
    const raw = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen);

    // The local header must agree with the central one.
    assert.equal(buf.readUInt32LE(local), 0x04034b50, `local header ${i}`);
    assert.equal(buf.readUInt16LE(local + 6), flags);
    assert.equal(buf.readUInt16LE(local + 8), method);
    assert.equal(buf.readUInt32LE(local + 14), crc);
    assert.equal(buf.readUInt32LE(local + 18), compressed);
    assert.equal(buf.readUInt32LE(local + 22), raw);
    assert.equal(buf.readUInt16LE(local + 26), nameLen);
    const localExtra = buf.readUInt16LE(local + 28);
    assert.ok(buf.subarray(local + 30, local + 30 + nameLen).equals(name));

    const dataStart = local + 30 + nameLen + localExtra;
    const data = inflateRawSync(buf.subarray(dataStart, dataStart + compressed));
    assert.equal(data.length, raw, "uncompressed size");
    assert.equal(crc32(data), crc, "crc");

    out.push({ path: name.toString("utf8"), content: data.toString("utf8"), flags, method, date, crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  assert.equal(p, end);
  return out;
}

describe("zip", () => {
  test("an empty archive is just the end record", () => {
    const buf = zip([]);
    assert.equal(buf.length, 22);
    assert.deepEqual(unzip(buf), []);
  });

  test("round-trips entries in order", () => {
    const entries: ZipEntry[] = [
      { path: "harness-components/SKILL.md", content: "# Harness components\n" },
      { path: "harness-components/catalog/secret.json", content: JSON.stringify({ a: 1 }, null, 2) },
      { path: "harness-components/candidate/", content: "" },
    ];
    assert.deepEqual(
      unzip(zip(entries)).map(({ path, content }) => ({ path, content })),
      entries,
    );
  });

  test("an empty file has the empty CRC", () => {
    const [entry] = unzip(zip([{ path: "empty.txt", content: "" }]));
    assert.equal(entry?.crc, 0);
    assert.equal(entry?.content, "");
  });

  test("computes the standard CRC-32", () => {
    // The check value every CRC-32 implementation is tested against.
    const [entry] = unzip(zip([{ path: "a", content: "The quick brown fox jumps over the lazy dog" }]));
    assert.equal(entry?.crc, 0x414fa339);
    const [check] = unzip(zip([{ path: "b", content: "123456789" }]));
    assert.equal(check?.crc, 0xcbf43926);
  });

  test("deflates, and compresses repetitive content", () => {
    const content = "abc".repeat(10_000);
    const buf = zip([{ path: "big.txt", content }]);
    const [entry] = unzip(buf);
    assert.equal(entry?.method, 8);
    assert.equal(entry?.content, content);
    assert.ok(buf.length < content.length / 10);
  });

  test("keeps multi-byte content intact", () => {
    const content = "Ünïcödé — ✓ 日本語 🚀\n";
    assert.equal(unzip(zip([{ path: "u.txt", content }]))[0]?.content, content);
  });

  test("stores a UTF-8 name as its UTF-8 bytes", () => {
    assert.equal(unzip(zip([{ path: "dir/café.md", content: "x" }]))[0]?.path, "dir/café.md");
  });

  test(
    "marks a non-ASCII name as UTF-8",
    {
      todo:
        "general purpose bit 11 is never set (zip.ts writes flags 0), so unzip tools read a " +
        "non-ASCII name as CP437 — latent while bundle paths are ASCII identifiers",
    },
    () => {
      const [entry] = unzip(zip([{ path: "café.md", content: "x" }]));
      assert.equal((entry?.flags ?? 0) & 0x0800, 0x0800);
    },
  );

  test("dates every entry 1980-01-01, so the same input gives the same bytes", () => {
    const entries = [{ path: "a", content: "1" }, { path: "b", content: "2" }];
    const a = zip(entries);
    const b = zip(entries);
    assert.ok(a.equals(b));
    for (const entry of unzip(a)) {
      assert.equal(entry.date, (0 << 9) | (1 << 5) | 1);
    }
  });

  test("handles many entries with correct offsets", () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({
      path: `catalog/c${i}.json`,
      content: `{"i":${i}}`.repeat(i % 7),
    }));
    assert.deepEqual(
      unzip(zip(entries)).map(({ path, content }) => ({ path, content })),
      entries,
    );
  });
});

/**
 * The hand-written migrations' names and shape. `scripts/apply-sql.mjs` runs
 * every drizzle/*.sql on every deploy, in name order, and keeps no record of
 * what has run, so a name only has to sort into the right place and each file
 * has to be safe to run again.
 *
 * Numbered names stop at 0063. Two branches that each took the next number
 * collided (there are two 0035s), so a new file is named for the UTC moment it
 * was written, `date -u +%Y%m%d%H%M%S`, which sorts after every numbered one.
 * A branch that still adds `0064_…` fails here and only needs renaming.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "../../drizzle");
const LAST_NUMBERED = 63;

const NUMBERED = /^(\d{4})_[a-z0-9_]+\.sql$/;
const TIMESTAMPED = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_[a-z0-9_]+\.sql$/;

const files = readdirSync(DIR).filter((f) => !f.startsWith("."));

describe("drizzle migrations", () => {
  test("finds them at all", () => {
    assert.ok(files.length > LAST_NUMBERED);
  });

  test("are .sql files named NNNN_name (up to 0063) or YYYYMMDDHHMMSS_name", () => {
    const wrong = files.filter((f) => !NUMBERED.test(f) && !TIMESTAMPED.test(f));
    assert.deepEqual(wrong, []);
  });

  test("take a timestamp rather than a number after 0063", () => {
    const late = files.filter((f) => Number(NUMBERED.exec(f)?.[1] ?? 0) > LAST_NUMBERED);
    assert.deepEqual(late, [], "name it `$(date -u +%Y%m%d%H%M%S)_what_it_does.sql` instead");
  });

  test("are timestamped with a real UTC date and time", () => {
    const wrong = files.filter((f) => {
      const m = TIMESTAMPED.exec(f);
      if (!m) return false;
      const [, y, mo, d, h, mi, s] = m.map(Number);
      const at = new Date(Date.UTC(y!, mo! - 1, d, h, mi, s));
      return (
        at.getUTCFullYear() !== y || at.getUTCMonth() !== mo! - 1 || at.getUTCDate() !== d ||
        at.getUTCHours() !== h || at.getUTCMinutes() !== mi || at.getUTCSeconds() !== s
      );
    });
    assert.deepEqual(wrong, []);
  });

  test("never share a timestamp", () => {
    const stamps = files.map((f) => TIMESTAMPED.exec(f)?.[0].slice(0, 14)).filter(Boolean);
    assert.deepEqual(stamps.filter((s, i) => stamps.indexOf(s) !== i), []);
  });

  test("each wrap themselves in a transaction", () => {
    const wrong = files.filter((f) => {
      const sql = readFileSync(join(DIR, f), "utf8");
      return !/^\s*begin\s*;/im.test(sql) || !/^\s*commit\s*;/im.test(sql);
    });
    assert.deepEqual(wrong, []);
  });
});

/**
 * The platform administrator's SQL console: its input checks.
 *
 * The console runs arbitrary text against the production database, inside a
 * read-only transaction. Everything past the checks needs a database and is
 * covered elsewhere; what is pinned here is that an empty or oversized query is
 * turned away with a message *before* a connection is taken from the pool — a
 * pool of five that a runaway client could otherwise drain. The pool is
 * replaced with one that fails the test if touched.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { pool } from "@/db";
import { MAX_ROWS, MAX_SQL_LENGTH, runReadOnlyQuery } from "@/lib/sql-console";

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

describe("runReadOnlyQuery input checks", () => {
  test("asks for a query when there is none", async () => {
    for (const sql of ["", "   ", "\n\t \n"]) {
      assert.deepEqual(await runReadOnlyQuery(sql), { ok: false, error: "Enter a query." });
    }
  });

  test("refuses a query over the length limit, naming the limit", async () => {
    const res = await runReadOnlyQuery(`select '${"x".repeat(MAX_SQL_LENGTH)}'`);
    assert.deepEqual(res, {
      ok: false,
      error: `Query is too long (max ${MAX_SQL_LENGTH} chars).`,
    });
  });

  test("measures the length after trimming", async () => {
    // Whitespace alone never counts as too long: it is an empty query.
    assert.deepEqual(await runReadOnlyQuery(" ".repeat(MAX_SQL_LENGTH * 2)), {
      ok: false,
      error: "Enter a query.",
    });
    const res = await runReadOnlyQuery(`   ${"x".repeat(MAX_SQL_LENGTH + 1)}   `);
    assert.equal(res.ok, false);
    assert.match((res as { error: string }).error, /too long/);
  });

  test("the limits are positive", () => {
    assert.ok(MAX_ROWS > 0);
    assert.ok(MAX_SQL_LENGTH > 0);
  });
});

/**
 * Lab guides: the input schema and the guards in front of the database.
 *
 * The schema is what the guide editor's API validates against, so it decides
 * what an author can store — and, by stripping unknown keys, what they cannot
 * (a slug or an author id of their choosing). The body is Markdown, where
 * leading spaces are meaning, so it must reach the database untrimmed.
 *
 * Every id-taking function is reached from a URL segment. A malformed id would
 * be a Postgres "invalid input syntax for type uuid" error — a 500 — so each
 * checks the shape first and answers not-found without a query. The pool is
 * replaced with one that fails the test if touched. The queries themselves, and
 * slug allocation, need a database and are not tested here.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { pool } from "@/db";
import { LAB_GUIDE_LIMITS } from "@/db/schema";
import {
  deleteLabGuide,
  getLabGuideById,
  labGuideSchema,
  updateLabGuide,
  workshopsUsingGuide,
} from "@/lib/lab-guides";

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

const NOT_IDS = ["", "new", "edit", "123", "not-a-uuid", "11111111-1111-4111-8111-11111111111", "' or 1=1 --"];

describe("labGuideSchema", () => {
  test("fills in an empty summary and body", () => {
    assert.deepEqual(labGuideSchema.parse({ title: "Set up" }), { title: "Set up", summary: "", body: "" });
  });

  test("trims the title and summary", () => {
    const parsed = labGuideSchema.parse({ title: "  Set up  ", summary: "\n A summary \t" });
    assert.equal(parsed.title, "Set up");
    assert.equal(parsed.summary, "A summary");
  });

  test("leaves the body exactly as written", () => {
    // Indentation is meaning in Markdown: a code block, a nested list.
    const body = "    indented code\n\n- item\n  - nested\n\n";
    assert.equal(labGuideSchema.parse({ title: "t", body }).body, body);
  });

  test("refuses a missing, empty or blank title", () => {
    for (const input of [{}, { title: "" }, { title: "   " }, { title: null }, { title: 3 }]) {
      assert.equal(labGuideSchema.safeParse(input).success, false, JSON.stringify(input));
    }
  });

  test("bounds each field at its column limit, after trimming", () => {
    const a = (n: number) => "a".repeat(n);
    const ok = (input: object) => labGuideSchema.safeParse(input).success;

    assert.equal(ok({ title: a(LAB_GUIDE_LIMITS.title) }), true);
    assert.equal(ok({ title: a(LAB_GUIDE_LIMITS.title + 1) }), false);
    assert.equal(ok({ title: `  ${a(LAB_GUIDE_LIMITS.title)}  ` }), true);

    assert.equal(ok({ title: "t", summary: a(LAB_GUIDE_LIMITS.summary) }), true);
    assert.equal(ok({ title: "t", summary: a(LAB_GUIDE_LIMITS.summary + 1) }), false);

    assert.equal(ok({ title: "t", body: a(LAB_GUIDE_LIMITS.body) }), true);
    assert.equal(ok({ title: "t", body: a(LAB_GUIDE_LIMITS.body + 1) }), false);
  });

  test("drops fields an author must not set", () => {
    const parsed = labGuideSchema.parse({
      title: "t",
      slug: "someone-elses-guide",
      authorId: "someone-else",
      id: "11111111-1111-4111-8111-111111111111",
    });
    assert.deepEqual(Object.keys(parsed).sort(), ["body", "summary", "title"]);
  });
});

describe("a malformed id never reaches the database", () => {
  const input = labGuideSchema.parse({ title: "t" });

  for (const id of NOT_IDS) {
    test(JSON.stringify(id), async () => {
      assert.equal(await getLabGuideById(id), null);
      assert.deepEqual(await workshopsUsingGuide(id), []);
      assert.deepEqual(await updateLabGuide(id, input), { ok: false, error: "not_found" });
      assert.equal(await deleteLabGuide(id), false);
    });
  }
});

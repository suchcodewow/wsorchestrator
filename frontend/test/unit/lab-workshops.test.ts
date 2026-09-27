/**
 * Lab workshops, each an ordered set of guides: the input schema and the guards
 * in front of the database.
 *
 * The schema decides what the workshop editor can save: a title, a summary, a
 * published flag that must be a real boolean (a string "false" is truthy), and
 * up to the limit of guide ids, each a UUID so the lookup that follows cannot
 * fail on a malformed one. Unknown keys are stripped, so a request cannot set
 * its own slug or author.
 *
 * Id-taking functions are reached from URL segments; a malformed id is answered
 * not-found without a query rather than surfacing Postgres's uuid syntax error
 * as a 500. The pool is replaced with one that fails the test if touched.
 * Queries, slug allocation and guide ordering need a database and are not
 * tested here.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { pool } from "@/db";
import { LAB_WORKSHOP_LIMITS } from "@/db/schema";
import {
  appendGuideToWorkshop,
  deleteLabWorkshop,
  getLabWorkshopById,
  labWorkshopSchema,
  updateLabWorkshop,
} from "@/lib/lab-workshops";

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

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOT_IDS = ["", "new", "guides", "42", "not-a-uuid", "' or 1=1 --"];

describe("labWorkshopSchema", () => {
  test("defaults to unpublished with no guides", () => {
    assert.deepEqual(labWorkshopSchema.parse({ title: "Day one" }), {
      title: "Day one",
      summary: "",
      published: false,
      guideIds: [],
    });
  });

  test("trims the title and summary", () => {
    const parsed = labWorkshopSchema.parse({ title: " Day one ", summary: "  s  " });
    assert.equal(parsed.title, "Day one");
    assert.equal(parsed.summary, "s");
  });

  test("refuses a missing or blank title", () => {
    for (const input of [{}, { title: "" }, { title: "  " }]) {
      assert.equal(labWorkshopSchema.safeParse(input).success, false, JSON.stringify(input));
    }
  });

  test("bounds the title and summary", () => {
    const ok = (input: object) => labWorkshopSchema.safeParse(input).success;
    assert.equal(ok({ title: "a".repeat(LAB_WORKSHOP_LIMITS.title) }), true);
    assert.equal(ok({ title: "a".repeat(LAB_WORKSHOP_LIMITS.title + 1) }), false);
    assert.equal(ok({ title: "t", summary: "a".repeat(LAB_WORKSHOP_LIMITS.summary) }), true);
    assert.equal(ok({ title: "t", summary: "a".repeat(LAB_WORKSHOP_LIMITS.summary + 1) }), false);
  });

  test("published must be a boolean, not a string that looks like one", () => {
    assert.equal(labWorkshopSchema.parse({ title: "t", published: true }).published, true);
    for (const published of ["true", "false", 1, 0, null]) {
      assert.equal(labWorkshopSchema.safeParse({ title: "t", published }).success, false, String(published));
    }
  });

  test("keeps guide ids in the order given, duplicates and all", () => {
    // De-duplication is `resolveContents`' job; the schema preserves intent.
    const ids = [uuid(3), uuid(1), uuid(3)];
    assert.deepEqual(labWorkshopSchema.parse({ title: "t", guideIds: ids }).guideIds, ids);
  });

  test("refuses a guide id that is not a UUID", () => {
    for (const bad of ["", "slug", 5, null, `${uuid(1)} `]) {
      assert.equal(labWorkshopSchema.safeParse({ title: "t", guideIds: [uuid(1), bad] }).success, false, String(bad));
    }
    assert.equal(labWorkshopSchema.safeParse({ title: "t", guideIds: uuid(1) }).success, false);
  });

  test("allows up to the guide limit and no more", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => uuid(i));
    assert.equal(labWorkshopSchema.safeParse({ title: "t", guideIds: ids(LAB_WORKSHOP_LIMITS.guides) }).success, true);
    assert.equal(
      labWorkshopSchema.safeParse({ title: "t", guideIds: ids(LAB_WORKSHOP_LIMITS.guides + 1) }).success,
      false,
    );
  });

  test("drops fields a request must not set", () => {
    const parsed = labWorkshopSchema.parse({ title: "t", slug: "x", authorId: "y", id: uuid(9) });
    assert.deepEqual(Object.keys(parsed).sort(), ["guideIds", "published", "summary", "title"]);
  });
});

describe("a malformed id never reaches the database", () => {
  const input = labWorkshopSchema.parse({ title: "t" });

  for (const id of NOT_IDS) {
    test(JSON.stringify(id), async () => {
      assert.equal(await getLabWorkshopById(id), null);
      assert.equal(await deleteLabWorkshop(id), false);
      assert.deepEqual(await updateLabWorkshop(id, input), { ok: false, error: "not_found" });
      assert.deepEqual(await appendGuideToWorkshop(id, uuid(1)), { ok: false, error: "not_found" });
    });
  }
});

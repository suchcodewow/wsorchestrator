/**
 * The pure parts of event booking: the slug a run's cloud resources are named
 * from, and the visibility filter every run query is built on.
 *
 * The slug ends up in GCP project ids, Azure resource-group names and Harness
 * org identifiers, all of which reject uppercase, accents and punctuation and
 * cap the length. A slug that slips through with a trailing hyphen or a
 * combining accent fails the apply, not the booking form — so the edge cases
 * here are the organizer-typed names that actually reach it.
 *
 * `ownedBy` decides whose runs a person sees. It is checked by shape only (no
 * query runs): no event access sees nothing, a manager sees everything, anyone
 * else is filtered to their own.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { PgDialect } from "drizzle-orm/pg-core";

import { canManageAnyEvent, canUseEvents, type Access } from "@/lib/roles";
import { ownedBy, slugify } from "@/lib/runs";
import { EVERY_ACCESS, PERSONAS, describeAccess } from "../support/access";

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    assert.equal(slugify("Harness CD Workshop"), "harness-cd-workshop");
  });

  test("strips accents rather than dropping the letter", () => {
    assert.equal(slugify("Café Crème Brûlée"), "cafe-creme-brulee");
    assert.equal(slugify("São Paulo Ñandú"), "sao-paulo-nandu");
  });

  test("collapses runs of punctuation and whitespace into one hyphen", () => {
    assert.equal(slugify("Q3 -- EMEA / Partners!!"), "q3-emea-partners");
    assert.equal(slugify("a\t\n b"), "a-b");
  });

  test("trims leading and trailing hyphens", () => {
    assert.equal(slugify("  --Kickoff--  "), "kickoff");
    assert.equal(slugify("(Beta)"), "beta");
  });

  test("keeps digits", () => {
    assert.equal(slugify("2026 Summit 01"), "2026-summit-01");
  });

  test("caps at 40 characters", () => {
    const slug = slugify("x".repeat(100));
    assert.equal(slug, "x".repeat(40));
  });

  test("never ends in a hyphen after truncation", () => {
    // 39 letters, then a separator: the cut lands right after the hyphen.
    const slug = slugify(`${"a".repeat(39)} tail`);
    assert.equal(slug, "a".repeat(39));
    assert.ok(!slug.endsWith("-"));
  });

  test("a name that slugs to nothing uses the fallback", () => {
    assert.equal(slugify(""), "workshop");
    assert.equal(slugify("   "), "workshop");
    assert.equal(slugify("!!!"), "workshop");
    assert.equal(slugify("日本語ワークショップ"), "workshop");
    assert.equal(slugify("🚀🚀"), "workshop");
    assert.equal(slugify("", "challenge"), "challenge");
  });

  test("output only ever contains lowercase letters, digits and single inner hyphens", () => {
    const inputs = ["Ünïcödé Wörkshöp", "A_B_C", "x.y.z", "--a--b--", "Mixed CASE 123 !!", "ﬁre"];
    for (const input of inputs) {
      const slug = slugify(input);
      assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${input} -> ${slug}`);
      assert.ok(slug.length <= 40);
    }
  });

  test("is stable: slugging a slug changes nothing", () => {
    for (const input of ["Harness CD Workshop", "Café", "x".repeat(60)]) {
      const once = slugify(input);
      assert.equal(slugify(once), once);
    }
  });
});

describe("ownedBy", () => {
  const dialect = new PgDialect();
  const viewer = (access: Access) => ({ id: "u1", access });
  /** The WHERE fragment as Postgres would receive it; no connection needed. */
  const render = (access: Access) => {
    const filter = ownedBy(viewer(access));
    if (filter === undefined) return undefined;
    const { sql, params } = dialect.sqlToQuery(filter);
    return { sql, params };
  };

  test("a manager, event administrator or platform administrator is not filtered", () => {
    assert.equal(render(PERSONAS.manager), undefined);
    assert.equal(render(PERSONAS.eventAdmin), undefined);
    assert.equal(render(PERSONAS.platform), undefined);
  });

  test("a contributor or operator sees only the runs they booked", () => {
    const own = { sql: '"workshop_runs"."user_id" = $1', params: ["u1"] };
    assert.deepEqual(render(PERSONAS.contributor), own);
    assert.deepEqual(render(PERSONAS.operator), own);
  });

  test("someone with no event access sees nothing, even their own, whatever their training role", () => {
    const nothing = { sql: "false", params: [] };
    assert.deepEqual(render(PERSONAS.nobody), nothing);
    assert.deepEqual(render(PERSONAS.trainingViewer), nothing);
    assert.deepEqual(render(PERSONAS.trainingAdmin), nothing);
  });

  test("every combination of roles gets one of the three answers, matching canUseEvents / canManageAnyEvent", () => {
    for (const access of EVERY_ACCESS) {
      const got = render(access);
      if (!canUseEvents(access)) assert.equal(got?.sql, "false", describeAccess(access));
      else if (canManageAnyEvent(access)) assert.equal(got, undefined, describeAccess(access));
      else assert.equal(got?.sql, '"workshop_runs"."user_id" = $1', describeAccess(access));
    }
  });
});

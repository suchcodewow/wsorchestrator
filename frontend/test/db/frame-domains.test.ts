/**
 * The frame allow-list: rows an administrator adds, edits and removes, and the
 * proxy's policy, which must follow a change made on the same instance at once
 * rather than after its cache runs out.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { allowedFrameDomains } from "@/db/schema";
import {
  addFrameDomain,
  deleteFrameDomain,
  frameAncestorsPolicy,
  listFrameDomains,
  updateFrameDomain,
} from "@/lib/frame-domains";
import { FRAME_DOMAIN_LIST } from "@/lib/list-specs";
import { PERSONAS } from "../support/access";
import { testScope } from "../support/seed";

const scope = testScope("framedomains");
const A = "wo-test-frame-a.example";
const B = "wo-test-frame-b.example";
const C = "wo-test-frame-c.example";

let actor: { id: string; email: string };

before(async () => {
  await scope.setUp();
  actor = await scope.createUser("admin", PERSONAS.platform);
});
after(async () => {
  // The rows outlive their author by design, so clear this suite's by domain.
  await db.delete(allowedFrameDomains).where(inArray(allowedFrameDomains.domain, [A, B, C]));
  await scope.tearDown();
});

async function rowFor(domain: string) {
  const page = await listFrameDomains({ q: domain, sort: FRAME_DOMAIN_LIST.sort, dir: FRAME_DOMAIN_LIST.dir, page: 1 });
  return page.rows.find((r) => r.domain === domain);
}

describe("frame domains", () => {
  test("an added domain is listed and framed at once", async () => {
    await frameAncestorsPolicy();
    assert.deepEqual(await addFrameDomain(actor, { domain: `https://${A}/course`, note: " LMS " }), { ok: true, domain: A });

    const row = await rowFor(A);
    assert.equal(row?.note, "LMS");
    assert.equal(row?.addedBy, "admin");
    assert.match(await frameAncestorsPolicy(), new RegExp(` ${A} \\*\\.${A}( |$)`));
  });

  test("refuses a duplicate or a non-domain", async () => {
    assert.deepEqual(await addFrameDomain(actor, { domain: A.toUpperCase() }), { ok: false, error: "duplicate" });
    assert.deepEqual(await addFrameDomain(actor, { domain: "not a domain" }), { ok: false, error: "invalid" });
  });

  test("an edit moves the policy with it", async () => {
    await addFrameDomain(actor, { domain: B });
    const row = await rowFor(B);
    assert.deepEqual(await updateFrameDomain(row!.id, { domain: A }), { ok: false, error: "duplicate" });
    assert.deepEqual(await updateFrameDomain(row!.id, { domain: C }), { ok: true, domain: C });

    const policy = await frameAncestorsPolicy();
    assert.ok(policy.includes(` ${C} `) || policy.endsWith(` *.${C}`));
    assert.ok(!policy.includes(B));
  });

  test("a removed domain is no longer framed", async () => {
    const row = await rowFor(A);
    assert.deepEqual(await deleteFrameDomain(row!.id), { ok: true, domain: A });
    assert.deepEqual(await deleteFrameDomain(row!.id), { ok: false, error: "not_found" });
    assert.ok(!(await frameAncestorsPolicy()).includes(A));
  });

  test("an unknown id is not found", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    assert.deepEqual(await updateFrameDomain(missing, { domain: A }), { ok: false, error: "not_found" });
  });
});

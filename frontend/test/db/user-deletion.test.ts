/**
 * Who may delete whose account, against a real database.
 *
 * The rules, in the order they apply:
 * 1. `self`        — nobody deletes their own account.
 * 2. `forbidden`   — only a platform administrator deletes accounts.
 * 3. `not_found`   — no such user.
 * 4. `bootstrap`   — SITE_ADMIN_EMAILS would recreate it on the next sign-in.
 * 5. `owns_events` — an event keeps its owner.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { apiTokens, labGuides, sessions, users, workshopRuns } from "@/db/schema";
import { deleteUser } from "@/lib/site-users";
import { PERSONAS, PERSONA_NAMES } from "../support/access";
import { createRun, createSession, testScope } from "../support/seed";

const scope = testScope("delete");

const BOOTSTRAP_EMAIL = "delete-bootstrap@roles.test";

const exists = async (id: string) =>
  (await db.select({ id: users.id }).from(users).where(eq(users.id, id))).length > 0;

let savedAdmins: string | undefined;
before(async () => {
  savedAdmins = process.env.SITE_ADMIN_EMAILS;
  process.env.SITE_ADMIN_EMAILS = BOOTSTRAP_EMAIL;
  await scope.setUp();
});
after(async () => {
  process.env.SITE_ADMIN_EMAILS = savedAdmins;
  await scope.tearDown();
});

describe("deleteUser", () => {
  test("only a platform administrator deletes, and never themselves", async () => {
    const wrong: string[] = [];
    for (const name of PERSONA_NAMES) {
      const actor = await scope.createUser(`a_${name}`, PERSONAS[name]);
      const target = await scope.createUser(`t_${name}`, PERSONAS.operator);

      const self = await deleteUser(actor, actor.id);
      if (self.ok || self.error !== "self") wrong.push(`${name} self: ${JSON.stringify(self)}`);

      const want = PERSONAS[name].platform ? "ok" : "forbidden";
      const result = await deleteUser(actor, target.id);
      const got = result.ok ? "ok" : result.error;
      if (got !== want) wrong.push(`${name}: got ${got}, want ${want}`);
      if ((await exists(target.id)) !== (want !== "ok")) {
        wrong.push(`${name}: target ${want === "ok" ? "still there" : "gone"}`);
      }
      if (!(await exists(actor.id))) wrong.push(`${name}: deleted themselves`);
    }
    assert.deepEqual(wrong, []);
  });

  test("a platform administrator can delete another one", async () => {
    const admin = await scope.createUser("pa_actor", PERSONAS.platform);
    const other = await scope.createUser("pa_target", PERSONAS.platform);
    assert.deepEqual(await deleteUser(admin, other.id), { ok: true });
    assert.equal(await exists(other.id), false);
  });

  test("a missing user is not_found to a platform administrator, forbidden to anyone else", async () => {
    const admin = await scope.createUser("nf_platform", PERSONAS.platform);
    const eventAdmin = await scope.createUser("nf_event", PERSONAS.eventAdmin);
    const missing = "wo_test_delete_does_not_exist";
    assert.deepEqual(await deleteUser(admin, missing), { ok: false, error: "not_found" });
    assert.deepEqual(await deleteUser(eventAdmin, missing), { ok: false, error: "forbidden" });
  });

  test("a SITE_ADMIN_EMAILS address is kept", async () => {
    const admin = await scope.createUser("bs_actor", PERSONAS.platform);
    const target = await scope.createUser("bs_target", PERSONAS.platform, BOOTSTRAP_EMAIL);
    assert.deepEqual(await deleteUser(admin, target.id), { ok: false, error: "bootstrap" });
    assert.equal(await exists(target.id), true);
  });

  test("someone who owns an event is kept, and so is the event", async () => {
    const admin = await scope.createUser("ev_actor", PERSONAS.platform);
    const owner = await scope.createUser("ev_owner", PERSONAS.operator);
    const runId = await createRun(owner.id, "kept");
    assert.deepEqual(await deleteUser(admin, owner.id), { ok: false, error: "owns_events" });
    assert.equal(await exists(owner.id), true);
    const [run] = await db.select().from(workshopRuns).where(eq(workshopRuns.id, runId));
    assert.equal(run?.userId, owner.id);
  });

  test("takes their sessions and tokens, and leaves what they wrote unattributed", async () => {
    const admin = await scope.createUser("gone_actor", PERSONAS.platform);
    const target = await scope.createUser("gone_target", PERSONAS.manager);
    const token = await createSession(target.id);
    await db.insert(apiTokens).values({
      userId: target.id,
      name: "t",
      tokenHash: "unused",
      prefix: `wo_test_delete_${Date.now()}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [guide] = await db
      .insert(labGuides)
      .values({ slug: `wo-test-delete-${Date.now()}`, title: "kept", authorId: target.id })
      .returning({ id: labGuides.id });

    try {
      assert.deepEqual(await deleteUser(admin, target.id), { ok: true });
      assert.equal(await exists(target.id), false);
      assert.equal(
        (await db.select().from(sessions).where(eq(sessions.sessionToken, token))).length,
        0,
      );
      assert.equal(
        (await db.select().from(apiTokens).where(eq(apiTokens.userId, target.id))).length,
        0,
      );
      const [kept] = await db.select().from(labGuides).where(eq(labGuides.id, guide!.id));
      assert.equal(kept?.authorId, null);
    } finally {
      await db.delete(labGuides).where(eq(labGuides.id, guide!.id));
    }
  });
});

/**
 * Invite links, against a real database.
 *
 * The rules, restated here independently of `user-invites.ts`:
 * 1. A link grants only the areas its creator administers — checked when it
 *    is made, and again every time it is used.
 * 2. It never grants platform administration.
 * 3. It gives roles only to someone with none; anyone else is left as they are.
 * 4. It works for anyone, any number of times, until it expires.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  EVALS_ROLES,
  EVENT_ROLES,
  INVITE_TTL_MINUTES,
  IRIS_ROLES,
  TRAINING_ROLES,
  userInvites,
  users,
} from "@/db/schema";
import type { Access } from "@/lib/roles";
import {
  acceptInvite,
  createInvite,
  readInvite,
  type InviteGrant,
} from "@/lib/user-invites";
import { PERSONAS, PERSONA_NAMES, describeAccess } from "../support/access";
import { readRoles, testScope } from "../support/seed";

const scope = testScope("invite");

before(() => scope.setUp());
after(() => scope.tearDown());

const GRANTS: InviteGrant[] = EVENT_ROLES.flatMap((event) =>
  [null, ...TRAINING_ROLES].flatMap((trainingRole) =>
    [null, ...EVALS_ROLES].flatMap((evalsRole) =>
      [null, ...IRIS_ROLES].map((irisRole) => ({
        eventRole: event === "none" ? null : event,
        trainingRole,
        evalsRole,
        irisRole,
      })),
    ),
  ),
);

const describeGrant = (g: InviteGrant) =>
  `event=${g.eventRole ?? "-"} training=${g.trainingRole ?? "-"} evals=${g.evalsRole ?? "-"} iris=${g.irisRole ?? "-"}`;

function expected(actor: Access, grant: InviteGrant): "ok" | "empty" | "forbidden" {
  if (
    grant.eventRole === null &&
    grant.trainingRole === null &&
    grant.evalsRole === null &&
    grant.irisRole === null
  ) {
    return "empty";
  }
  const event = actor.platform || actor.event === "administrator";
  const training = actor.platform || actor.training === "administrator";
  const evals = actor.platform || actor.evals === "administrator";
  const iris = actor.platform || actor.iris === "administrator";
  if (grant.eventRole !== null && !event) return "forbidden";
  if (grant.trainingRole !== null && !training) return "forbidden";
  if (grant.evalsRole !== null && !evals) return "forbidden";
  if (grant.irisRole !== null && !iris) return "forbidden";
  return "ok";
}

async function mint(actor: { id: string; access: Access }, grant: InviteGrant) {
  const result = await createInvite(actor, grant);
  assert.ok(result.ok, `createInvite: ${JSON.stringify(result)}`);
  return result.token;
}

async function usesOf(token: string) {
  const read = await readInvite(token);
  assert.ok(read.ok);
  const [row] = await db
    .select({ uses: userInvites.uses })
    .from(userInvites)
    .where(eq(userInvites.id, read.invite.id));
  return row!.uses;
}

describe("making a link", () => {
  for (const name of PERSONA_NAMES) {
    test(`as ${name} (${describeAccess(PERSONAS[name])})`, async () => {
      const actor = await scope.createUser(`mk_${name}`, PERSONAS[name]);
      const wrong: string[] = [];
      for (const grant of GRANTS) {
        const want = expected(actor.access, grant);
        const result = await createInvite(actor, grant);
        const got = result.ok ? "ok" : result.error;
        if (got !== want) wrong.push(`${describeGrant(grant)}: got ${got}, want ${want}`);
      }
      assert.deepEqual(wrong, []);
    });
  }

  test(`expires ${INVITE_TTL_MINUTES} minutes out`, async () => {
    const admin = await scope.createUser("ttl_admin", PERSONAS.eventAdmin);
    const before = Date.now();
    const result = await createInvite(admin, { eventRole: "operator", trainingRole: null, evalsRole: null, irisRole: null });
    assert.ok(result.ok);
    const minutes = (result.expiresAt.getTime() - before) / 60_000;
    assert.ok(Math.abs(minutes - INVITE_TTL_MINUTES) < 0.1, `${minutes} minutes`);
  });

  test("only the hash is stored, never the token", async () => {
    const admin = await scope.createUser("hash_admin", PERSONAS.eventAdmin);
    const token = await mint(admin, { eventRole: "operator", trainingRole: null, evalsRole: null, irisRole: null });
    const rows = await db
      .select({ hash: userInvites.tokenHash })
      .from(userInvites)
      .where(eq(userInvites.createdBy, admin.id));
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0]!.hash, token);
    assert.ok(!rows[0]!.hash.includes(token));
  });
});

describe("using a link", () => {
  test("someone with no access gets exactly the roles it names", async () => {
    const admin = await scope.createUser("use_admin", PERSONAS.platform);
    for (const grant of GRANTS.filter((g) => g.eventRole || g.trainingRole || g.evalsRole || g.irisRole)) {
      const token = await mint(admin, grant);
      const newcomer = await scope.createUser("use_newcomer", PERSONAS.nobody);
      assert.deepEqual(await acceptInvite(newcomer.id, token), { ok: true, applied: true, grant });
      assert.deepEqual(await readRoles(newcomer.id), {
        event: grant.eventRole ?? "none",
        training: grant.trainingRole,
        evals: grant.evalsRole,
        iris: grant.irisRole,
        platform: false,
        judging: false,
      }, describeGrant(grant));
    }
  });

  test("a platform administrator's link never makes anyone a platform administrator", async () => {
    const admin = await scope.createUser("plat_admin", PERSONAS.platform);
    const token = await mint(admin, { eventRole: "administrator", trainingRole: "administrator", evalsRole: null, irisRole: null });
    const newcomer = await scope.createUser("plat_newcomer", PERSONAS.nobody);
    await acceptInvite(newcomer.id, token);
    assert.equal((await readRoles(newcomer.id))?.platform, false);
  });

  test("anyone who already has access is left exactly as they are", async () => {
    const admin = await scope.createUser("keep_admin", PERSONAS.platform);
    const token = await mint(admin, {
      eventRole: "administrator",
      trainingRole: "administrator",
      evalsRole: "administrator",
      irisRole: "administrator",
    });
    // A guest judge holds no stored role, so a link applies to them as to nobody.
    for (const name of PERSONA_NAMES.filter((p) => p !== "nobody" && p !== "guestJudge")) {
      const existing = await scope.createUser(`keep_${name}`, PERSONAS[name]);
      const result = await acceptInvite(existing.id, token);
      assert.ok(result.ok && !result.applied, name);
      assert.deepEqual(await readRoles(existing.id), PERSONAS[name], name);
    }
    assert.equal(await usesOf(token), 0);
  });

  test("works for more than one person, and counts each one", async () => {
    const admin = await scope.createUser("multi_admin", PERSONAS.eventAdmin);
    const token = await mint(admin, { eventRole: "operator", trainingRole: null, evalsRole: null, irisRole: null });
    for (const key of ["multi_a", "multi_b", "multi_c"]) {
      const newcomer = await scope.createUser(key, PERSONAS.nobody);
      assert.ok((await acceptInvite(newcomer.id, token)).ok);
      assert.equal((await readRoles(newcomer.id))?.event, "operator", key);
    }
    assert.equal(await usesOf(token), 3);
  });

  test("an expired link gives nothing", async () => {
    const admin = await scope.createUser("exp_admin", PERSONAS.eventAdmin);
    const token = await mint(admin, { eventRole: "operator", trainingRole: null, evalsRole: null, irisRole: null });
    await db
      .update(userInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(userInvites.createdBy, admin.id));

    const newcomer = await scope.createUser("exp_newcomer", PERSONAS.nobody);
    assert.deepEqual(await acceptInvite(newcomer.id, token), { ok: false, error: "expired" });
    assert.deepEqual(await readRoles(newcomer.id), PERSONAS.nobody);
  });

  test("a link stops working when its creator loses the role, and not before", async () => {
    const admin = await scope.createUser("rev_admin", PERSONAS.bothAdmins);
    const eventLink = await mint(admin, { eventRole: "operator", trainingRole: null, evalsRole: null, irisRole: null });
    const trainingLink = await mint(admin, { eventRole: null, trainingRole: "viewer", evalsRole: null, irisRole: null });

    // Down to training administrator only: the event link dies, the other lives.
    await scope.createUser("rev_admin", PERSONAS.trainingAdmin);
    const newcomer = await scope.createUser("rev_newcomer", PERSONAS.nobody);
    assert.deepEqual(await acceptInvite(newcomer.id, eventLink), { ok: false, error: "revoked" });
    assert.deepEqual(await readRoles(newcomer.id), PERSONAS.nobody);
    assert.ok((await acceptInvite(newcomer.id, trainingLink)).ok);
    assert.equal((await readRoles(newcomer.id))?.training, "viewer");
  });

  test("a link dies with the administrator who made it", async () => {
    const admin = await scope.createUser("gone_admin", PERSONAS.eventAdmin);
    const token = await mint(admin, { eventRole: "operator", trainingRole: null, evalsRole: null, irisRole: null });
    await db.delete(users).where(eq(users.id, admin.id));
    assert.deepEqual(await readInvite(token), { ok: false, error: "not_found" });
  });

  test("a made-up token finds nothing", async () => {
    const newcomer = await scope.createUser("fake_newcomer", PERSONAS.nobody);
    for (const token of ["", "short", "A".repeat(32), "x".repeat(200), "../../etc/passwd"]) {
      assert.deepEqual(await acceptInvite(newcomer.id, token), { ok: false, error: "not_found" }, token);
    }
    assert.deepEqual(await readRoles(newcomer.id), PERSONAS.nobody);
  });
});

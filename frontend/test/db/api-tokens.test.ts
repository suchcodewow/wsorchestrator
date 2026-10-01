/**
 * Personal access tokens, and the roles a request made with one carries.
 *
 * A token stands in for its owner on the API routes that accept one, so what
 * matters most is that it carries the owner's roles *as they are now*: a token
 * minted by an administrator who has since been demoted must act as the
 * demoted user, not as the administrator it was minted by. The rest pins what
 * makes a token unusable — revoked, expired, altered — since each of those is
 * a request that has to be treated as signed out.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { apiTokens, MAX_TOKENS_PER_USER } from "@/db/schema";
import {
  listTokens,
  mintToken,
  resolveToken,
  revokeToken,
} from "@/lib/api-tokens";
import { PERSONAS, PERSONA_NAMES } from "../support/access";
import { testScope } from "../support/seed";

const scope = testScope("tok");

before(() => scope.setUp());
after(() => scope.tearDown());

async function mint(userId: string, name = "test") {
  const result = await mintToken(userId, name);
  assert.ok(result.ok, JSON.stringify(result));
  return result.token;
}

describe("resolveToken carries the owner's roles", () => {
  for (const p of PERSONA_NAMES) {
    test(p, async () => {
      const user = await scope.createUser(p, PERSONAS[p]);
      const { token } = await mint(user.id);
      assert.deepEqual(await resolveToken(token), {
        id: user.id,
        access: PERSONAS[p],
        email: user.email,
      });
    });
  }

  test("as they are now, not as they were when it was minted", async () => {
    const user = await scope.createUser("demoted", PERSONAS.platform);
    const { token } = await mint(user.id);
    assert.equal((await resolveToken(token))?.access.platform, true);

    await scope.createUser("demoted", PERSONAS.nobody);
    assert.deepEqual((await resolveToken(token))?.access, PERSONAS.nobody);
  });
});

describe("an unusable token resolves to nobody", () => {
  test("revoked", async () => {
    const user = await scope.createUser("revoked", PERSONAS.operator);
    const minted = await mint(user.id);
    assert.equal(await revokeToken(user.id, minted.id), true);
    assert.equal(await resolveToken(minted.token), null);
  });

  test("expired", async () => {
    const user = await scope.createUser("expired", PERSONAS.operator);
    const minted = await mint(user.id);
    await db
      .update(apiTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiTokens.id, minted.id));
    assert.equal(await resolveToken(minted.token), null);
  });

  test("altered secret, same prefix", async () => {
    const user = await scope.createUser("altered", PERSONAS.operator);
    const { token } = await mint(user.id);
    const last = token.at(-1) === "A" ? "B" : "A";
    assert.equal(await resolveToken(token.slice(0, -1) + last), null);
  });

  test("malformed", async () => {
    for (const bad of ["", "wo_", "wo_nothex_secret", "Bearer wo_x", "not-a-token", "wo_0123456789abcdef"]) {
      assert.equal(await resolveToken(bad), null, JSON.stringify(bad));
    }
  });

  test("an unknown prefix", async () => {
    assert.equal(await resolveToken(`wo_${"0".repeat(16)}_whatever`), null);
  });
});

describe("minting and revoking", () => {
  test("a name is required", async () => {
    const user = await scope.createUser("noname", PERSONAS.operator);
    assert.deepEqual(await mintToken(user.id, "   "), { ok: false, error: "invalid_name" });
  });

  test(`at most ${MAX_TOKENS_PER_USER} live manual tokens each`, async () => {
    const user = await scope.createUser("many", PERSONAS.operator);
    for (let i = 0; i < MAX_TOKENS_PER_USER; i++) await mint(user.id, `t${i}`);
    assert.deepEqual(await mintToken(user.id, "one more"), { ok: false, error: "too_many" });

    // Revoking one frees a slot.
    const [first] = await listTokens(user.id);
    await revokeToken(user.id, first!.id);
    assert.equal((await mintToken(user.id, "replacement")).ok, true);
  });

  test("nobody revokes someone else's token", async () => {
    const owner = await scope.createUser("owner", PERSONAS.operator);
    const admin = await scope.createUser("admin", PERSONAS.platform);
    const minted = await mint(owner.id);
    assert.equal(await revokeToken(admin.id, minted.id), false);
    assert.notEqual(await resolveToken(minted.token), null);
  });

  test("listTokens reports status, and never the secret", async () => {
    const user = await scope.createUser("list", PERSONAS.operator);
    const live = await mint(user.id, "live");
    const gone = await mint(user.id, "gone");
    await revokeToken(user.id, gone.id);

    const listed = await listTokens(user.id);
    assert.deepEqual(
      listed.map((t) => [t.name, t.status]),
      [
        ["live", "active"],
        ["gone", "revoked"],
      ],
    );
    assert.ok(!JSON.stringify(listed).includes(live.token));
  });
});

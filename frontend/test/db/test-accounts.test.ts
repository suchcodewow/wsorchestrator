/**
 * Making and resetting test accounts, against a real database.
 *
 * The rules:
 * 1. Only a platform administrator makes or resets one, and never on production.
 * 2. One is made with no roles, on the reserved domain, flagged as a test account.
 * 3. A reset takes everything that is its own (Iris track and sittings
 *    included) and keeps its id, name, address and roles.
 * 4. A real account is never reset, and neither is one that owns an event.
 * 5. Only test accounts are found to view as, and none on production.
 *
 * Accounts made through `createTestAccount` get random ids, which the scope's
 * cleanup cannot find, so the suite deletes them by the ids it was given.
 */

import "../support/test-env";

process.env.DEPLOYMENT_ENVIRONMENT = "qa";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { irisAttempts, irisTakers, users } from "@/db/schema";
import { setTrack, startSitting } from "@/lib/iris/attempts";
import { impersonationTarget } from "@/lib/impersonation";
import {
  TEST_ACCOUNT_DOMAIN,
  createTestAccount,
  resetTestAccount,
  searchTestAccounts,
} from "@/lib/test-accounts";
import { PERSONAS } from "../support/access";
import { createRun, testScope, type TestUser } from "../support/seed";

const scope = testScope("testacct");
const made: string[] = [];
let admin: TestUser;

before(async () => {
  await scope.setUp();
  admin = await scope.createUser("admin", PERSONAS.platform);
});
after(async () => {
  if (made.length) await db.delete(users).where(inArray(users.id, made));
  await scope.tearDown();
});

async function make(name: string) {
  const result = await createTestAccount(admin, name);
  assert.ok(result.ok, JSON.stringify(result));
  made.push(result.account.id);
  return result.account;
}

/** A scope user flagged as a test account, so the scope's cleanup removes it. */
async function flagged(key: string) {
  const user = await scope.createUser(key, PERSONAS.assessmentsViewer);
  await db.update(users).set({ isTestAccount: true }).where(eq(users.id, user.id));
  return user;
}

const asProduction = async <T>(fn: () => Promise<T>): Promise<T> => {
  process.env.DEPLOYMENT_ENVIRONMENT = "production";
  try {
    return await fn();
  } finally {
    process.env.DEPLOYMENT_ENVIRONMENT = "qa";
  }
};

describe("createTestAccount", () => {
  test("makes a flagged account with no roles on the reserved domain", async () => {
    const account = await make("  Iris tester  ");
    const [row] = await db.select().from(users).where(eq(users.id, account.id));
    assert.equal(row!.name, "Iris tester");
    assert.ok(row!.email!.endsWith(`@${TEST_ACCOUNT_DOMAIN}`), row!.email!);
    assert.deepEqual(
      [row!.isTestAccount, row!.eventRole, row!.trainingRole, row!.assessmentsRole, row!.isPlatformAdmin],
      [true, "none", null, null, false],
    );
  });

  test("refuses anyone but a platform administrator, a blank name, and production", async () => {
    const userAdmin = await scope.createUser("userAdmin", PERSONAS.bothAdmins);
    assert.deepEqual(await createTestAccount(userAdmin, "x"), { ok: false, error: "forbidden" });
    assert.deepEqual(await createTestAccount(admin, "   "), { ok: false, error: "invalid" });
    assert.deepEqual(await asProduction(() => createTestAccount(admin, "x")), { ok: false, error: "production" });
  });
});

describe("resetTestAccount", () => {
  test("takes its Iris track and sittings, and keeps who it is", async () => {
    const account = await flagged("reset");
    await setTrack(account.id, "SDR");
    const started = await startSitting(account.id, "sdlc", "A", "preview");
    assert.ok(started.ok, JSON.stringify(started));
    const [before] = await db.select().from(users).where(eq(users.id, account.id));

    assert.deepEqual(await resetTestAccount(admin, account.id), { ok: true });

    const [after] = await db.select().from(users).where(eq(users.id, account.id));
    assert.deepEqual(after, before);
    assert.equal((await db.select().from(irisTakers).where(eq(irisTakers.userId, account.id))).length, 0);
    assert.equal((await db.select().from(irisAttempts).where(eq(irisAttempts.userId, account.id))).length, 0);
  });

  test("never resets a real account, one that owns an event, or on production", async () => {
    const real = await scope.createUser("real", PERSONAS.assessmentsViewer);
    await setTrack(real.id, "AE");
    assert.deepEqual(await resetTestAccount(admin, real.id), { ok: false, error: "not_found" });
    assert.equal((await db.select().from(irisTakers).where(eq(irisTakers.userId, real.id))).length, 1);

    const owner = await flagged("owner");
    await createRun(owner.id, "owned");
    assert.deepEqual(await resetTestAccount(admin, owner.id), { ok: false, error: "owns_events" });

    const account = await flagged("prod");
    assert.deepEqual(await asProduction(() => resetTestAccount(admin, account.id)), { ok: false, error: "production" });
    const userAdmin = await scope.createUser("userAdmin", PERSONAS.bothAdmins);
    assert.deepEqual(await resetTestAccount(userAdmin, account.id), { ok: false, error: "forbidden" });
  });
});

describe("finding one to view as", () => {
  test("finds test accounts only, and none on production", async () => {
    const account = await make("Findable tester");
    const real = await scope.createUser("findable", PERSONAS.nobody);

    const found = await searchTestAccounts("findable");
    assert.deepEqual(found.map((a) => a.id), [account.id]);

    const target = await impersonationTarget(account.email.toUpperCase());
    assert.deepEqual([target?.id, target?.testAccount], [account.id, true]);
    // A real account with no employee row is nobody to view as.
    assert.equal(await impersonationTarget(real.email), null);

    await asProduction(async () => {
      assert.deepEqual(await searchTestAccounts("findable"), []);
      assert.equal(await impersonationTarget(account.email), null);
    });
  });
});

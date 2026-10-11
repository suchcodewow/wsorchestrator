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
 * 6. One copies from an address: an account's, or an employee's who has
 *    never signed in, which gives no roles.
 * 7. The suggested name is a character's that no account has yet.
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
  suggestTestAccountName,
} from "@/lib/test-accounts";
import { CHARACTER_NAMES } from "@/lib/test-account-names";
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

  test("copies another account's roles, settings and Iris track, once, and nothing else", async () => {
    const source = await scope.createUser("source", { ...PERSONAS.manager, training: "viewer", assessments: "viewer" });
    await db.update(users).set({ themePreference: "dark", calendarScope: "all" }).where(eq(users.id, source.id));
    await setTrack(source.id, "SE");
    const sat = await startSitting(source.id, "sdlc", "A", "preview");
    assert.ok(sat.ok, JSON.stringify(sat));

    // An address in any case finds them, as the employee list's lowercased one does.
    const result = await createTestAccount(admin, "Copy of source", source.email.toUpperCase());
    assert.ok(result.ok, JSON.stringify(result));
    made.push(result.account.id);

    const [row] = await db.select().from(users).where(eq(users.id, result.account.id));
    assert.deepEqual(
      [row!.eventRole, row!.trainingRole, row!.assessmentsRole, row!.themePreference, row!.calendarScope],
      ["manager", "viewer", "viewer", "dark", "all"],
    );
    assert.deepEqual([row!.isTestAccount, row!.isPlatformAdmin, row!.name], [true, false, "Copy of source"]);
    assert.notEqual(row!.email, source.email);
    const [taker] = await db.select().from(irisTakers).where(eq(irisTakers.userId, row!.id));
    assert.equal(taker?.track, "SE");
    assert.equal((await db.select().from(irisAttempts).where(eq(irisAttempts.userId, row!.id))).length, 0);

    // Once: a later change to the source does not reach the copy.
    await db.update(users).set({ eventRole: "none" }).where(eq(users.id, source.id));
    const [again] = await db.select({ eventRole: users.eventRole }).from(users).where(eq(users.id, row!.id));
    assert.equal(again!.eventRole, "manager");
  });

  test("copies an employee who has never signed in as no roles", async () => {
    const address = await scope.createEmployee("newcomer");
    const result = await createTestAccount(admin, "Copy of newcomer", address);
    assert.ok(result.ok, JSON.stringify(result));
    made.push(result.account.id);

    const [row] = await db.select().from(users).where(eq(users.id, result.account.id));
    assert.deepEqual(
      [row!.isTestAccount, row!.eventRole, row!.trainingRole, row!.assessmentsRole, row!.isPlatformAdmin],
      [true, "none", null, null, false],
    );
    assert.equal((await db.select().from(irisTakers).where(eq(irisTakers.userId, row!.id))).length, 0);
  });

  test("refuses to copy a platform administrator, or an address nobody has", async () => {
    assert.deepEqual(await createTestAccount(admin, "x", admin.email), { ok: false, error: "platform_source" });
    assert.deepEqual(await createTestAccount(admin, "x", "wo_test_testacct_missing@example.invalid"), {
      ok: false,
      error: "source_not_found",
    });
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

describe("suggestTestAccountName", () => {
  test("asked for another, is never the one shown", async () => {
    const shown = await suggestTestAccountName();
    assert.ok(shown);
    for (let i = 0; i < 20; i++) assert.notEqual(await suggestTestAccountName(shown), shown);
  });

  test("is a character's name that no account has yet", async () => {
    // The scratch database may hold some already, so keep free one it does not.
    const free = await suggestTestAccountName();
    assert.ok(free && (CHARACTER_NAMES as readonly string[]).includes(free), String(free));

    // Every other name taken, by scope users the cleanup removes; case doesn't matter.
    const taken = CHARACTER_NAMES.filter((n) => n !== free);
    for (const [i, name] of taken.entries()) {
      const user = await scope.createUser(`named${i}`, PERSONAS.nobody);
      await db.update(users).set({ name: i === 0 ? name.toUpperCase() : name }).where(eq(users.id, user.id));
    }
    assert.equal(await suggestTestAccountName(), free);
    // Asked for another, with none left but the one shown, there is none.
    assert.equal(await suggestTestAccountName(free!), null);

    const last = await scope.createUser("namedLast", PERSONAS.nobody);
    await db.update(users).set({ name: free }).where(eq(users.id, last.id));
    assert.equal(await suggestTestAccountName(), null);
  });

  test("is none on production", async () => {
    assert.equal(await asProduction(() => suggestTestAccountName()), null);
  });
});

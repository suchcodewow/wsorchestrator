/**
 * Adding an employee as an account, against a real database.
 *
 * The rules:
 * 1. Only a platform administrator adds one.
 * 2. The address must be an employee's; the account takes their name and the
 *    roles given, platform administration included.
 * 3. An address that already has an account, in any case, is refused.
 *
 * Accounts made through `addUser` get random ids, which the scope's cleanup
 * cannot find, so the suite deletes them by the ids it was given.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { addUser, type NewUserRoles } from "@/lib/site-users";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("adduser");
const made: string[] = [];
let admin: TestUser;

const NO_ROLES: NewUserRoles = { eventRole: "none", trainingRole: null, assessmentsRole: null, isPlatformAdmin: false };

before(async () => {
  await scope.setUp();
  admin = await scope.createUser("admin", PERSONAS.platform);
});
after(async () => {
  if (made.length) await db.delete(users).where(inArray(users.id, made));
  await scope.tearDown();
});

describe("addUser", () => {
  test("a platform administrator adds an employee with the roles given", async () => {
    const email = await scope.createEmployee("newcomer");
    const roles: NewUserRoles = { eventRole: "manager", trainingRole: "viewer", assessmentsRole: "administrator", isPlatformAdmin: false };
    const result = await addUser(admin, email.toUpperCase(), roles);
    assert.ok(result.ok, JSON.stringify(result));
    made.push(result.user.id);

    const [row] = await db.select().from(users).where(eq(users.id, result.user.id));
    assert.deepEqual(
      [row!.email, row!.name, row!.eventRole, row!.trainingRole, row!.assessmentsRole, row!.isPlatformAdmin],
      [email, "newcomer employee", "manager", "viewer", "administrator", false],
    );
  });

  test("can make a platform administrator", async () => {
    const email = await scope.createEmployee("chief");
    const result = await addUser(admin, email, { ...NO_ROLES, isPlatformAdmin: true });
    assert.ok(result.ok, JSON.stringify(result));
    made.push(result.user.id);
    const [row] = await db.select({ p: users.isPlatformAdmin }).from(users).where(eq(users.id, result.user.id));
    assert.equal(row!.p, true);
  });

  test("an area administrator may not add anyone", async () => {
    const email = await scope.createEmployee("refused");
    for (const persona of [PERSONAS.eventAdmin, PERSONAS.trainingAdmin, PERSONAS.assessmentsAdmin]) {
      assert.deepEqual(await addUser({ access: persona }, email, NO_ROLES), { ok: false, error: "forbidden" });
    }
  });

  test("refuses someone who is not on the employee list", async () => {
    const result = await addUser(admin, `nobody-${Date.now()}@example.invalid`, NO_ROLES);
    assert.deepEqual(result, { ok: false, error: "not_employee" });
  });

  test("refuses an address that already has an account, whatever its case", async () => {
    const existing = await scope.createUser("existing", PERSONAS.nobody);
    await scope.createEmployee("existing", existing.email);
    await db.update(users).set({ email: existing.email.toUpperCase() }).where(eq(users.id, existing.id));
    assert.deepEqual(await addUser(admin, existing.email, NO_ROLES), { ok: false, error: "exists" });
  });
});

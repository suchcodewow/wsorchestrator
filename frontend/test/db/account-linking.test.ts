/**
 * Which Google sign-ins may link to an account found by address, against a
 * real database.
 *
 * The rules:
 * 1. An address with no account, or an account with no Google account linked
 *    (added before they first signed in), may sign in.
 * 2. The Google account already linked to it may sign in, whatever the
 *    address's case.
 * 3. A different Google account with the same address is refused: the
 *    address has passed to someone new.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { accounts } from "@/db/schema";
import { isAddressReused } from "@/lib/account-linking";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("linking");
const GOOGLE_ID = "e2e-linking-google-1";
let added: TestUser;
let linked: TestUser;

before(async () => {
  await scope.setUp();
  added = await scope.createUser("added", PERSONAS.operator);
  linked = await scope.createUser("linked", PERSONAS.operator);
  await db.insert(accounts).values({
    userId: linked.id,
    type: "oidc",
    provider: "google",
    providerAccountId: GOOGLE_ID,
  });
});
after(async () => {
  await db.delete(accounts).where(eq(accounts.providerAccountId, GOOGLE_ID));
  await scope.tearDown();
});

describe("isAddressReused", () => {
  test("an address with no account is not reused", async () => {
    assert.equal(await isAddressReused(`nobody-${Date.now()}@example.invalid`, "any"), false);
    assert.equal(await isAddressReused(null, "any"), false);
  });

  test("an account added before its first sign-in links to whoever signs in with it", async () => {
    assert.equal(await isAddressReused(added.email, "e2e-linking-google-new"), false);
  });

  test("the Google account already linked signs in as before", async () => {
    assert.equal(await isAddressReused(linked.email.toUpperCase(), GOOGLE_ID), false);
  });

  test("a different Google account with the same address is refused", async () => {
    assert.equal(await isAddressReused(linked.email, "e2e-linking-google-2"), true);
  });
});

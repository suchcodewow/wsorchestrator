/**
 * Signing in copies the Google account's current name and photo onto the user,
 * against a real database. Auth.js writes them only when the user is created.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { syncGoogleProfile } from "@/lib/google-profile";
import { PERSONAS } from "../support/access";
import { testScope } from "../support/seed";

const scope = testScope("gprofile");

const PHOTO = "https://lh3.googleusercontent.com/a/new-photo=s96-c";

const stored = async (id: string) =>
  (await db.select({ name: users.name, image: users.image }).from(users).where(eq(users.id, id)))[0];

before(() => scope.setUp());
after(() => scope.tearDown());

describe("syncGoogleProfile", () => {
  test("a new name and photo replace the stored ones", async () => {
    const user = await scope.createUser("renamed", PERSONAS.operator);
    await db.update(users).set({ image: "https://lh3.googleusercontent.com/a/old" }).where(eq(users.id, user.id));

    await syncGoogleProfile(user.id, { name: "New Name", picture: PHOTO });

    assert.deepEqual(await stored(user.id), { name: "New Name", image: PHOTO });
  });

  test("a profile with no photo clears the stored one", async () => {
    const user = await scope.createUser("nophoto", PERSONAS.operator);
    await db.update(users).set({ image: PHOTO }).where(eq(users.id, user.id));

    await syncGoogleProfile(user.id, { name: "Still Here" });

    assert.deepEqual(await stored(user.id), { name: "Still Here", image: null });
  });

  test("Google's generated initial is not stored as a photo", async () => {
    const user = await scope.createUser("default", PERSONAS.operator);
    await db.update(users).set({ image: PHOTO }).where(eq(users.id, user.id));

    await syncGoogleProfile(user.id, { name: "Initial Only", picture: PHOTO }, false);

    assert.deepEqual(await stored(user.id), { name: "Initial Only", image: null });
  });

  test("when the People API cannot say, the ID token's picture is kept", async () => {
    const user = await scope.createUser("unknown", PERSONAS.operator);

    await syncGoogleProfile(user.id, { name: "Unknown", picture: PHOTO }, null);

    assert.deepEqual(await stored(user.id), { name: "Unknown", image: PHOTO });
  });

  test("a profile with no name keeps the stored one", async () => {
    const user = await scope.createUser("noname", PERSONAS.operator);

    await syncGoogleProfile(user.id, { name: "  ", picture: PHOTO });

    assert.deepEqual(await stored(user.id), { name: "noname", image: PHOTO });
  });

  test("touches only the user signing in", async () => {
    const signingIn = await scope.createUser("me", PERSONAS.operator);
    const bystander = await scope.createUser("other", PERSONAS.operator);

    await syncGoogleProfile(signingIn.id, { name: "Me", picture: PHOTO });

    assert.deepEqual(await stored(bystander.id), { name: "other", image: null });
  });
});

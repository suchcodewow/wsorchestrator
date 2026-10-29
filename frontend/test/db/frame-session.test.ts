/**
 * The frame sign-in ticket: it starts a session for the user who asked for
 * it, once, and only within its minute.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq, like } from "drizzle-orm";

import { db } from "@/db";
import { sessions, verificationTokens } from "@/db/schema";
import { claimFrameTicket, mintFrameTicket } from "@/lib/frame-session";
import { PERSONAS } from "../support/access";
import { TEST_PREFIX } from "../support/db";
import { testScope } from "../support/seed";

const scope = testScope("frame");

before(() => scope.setUp());
after(async () => {
  // Tickets are not tied to the user by a foreign key, so clear this suite's by hand.
  await db.delete(verificationTokens).where(like(verificationTokens.identifier, `frame-signin:${TEST_PREFIX}frame_%`));
  await scope.tearDown();
});

describe("claimFrameTicket", () => {
  test("starts a session for the ticket's user", async () => {
    const user = await scope.createUser("claim", PERSONAS.nobody);
    const claimed = await claimFrameTicket(await mintFrameTicket(user.id));
    assert.ok(claimed);
    assert.equal(claimed.user.id, user.id);
    assert.equal(claimed.user.email, user.email);

    const [row] = await db.select().from(sessions).where(eq(sessions.sessionToken, claimed.sessionToken));
    assert.equal(row?.userId, user.id);
    assert.equal(row?.impersonatingEmail, null);
    assert.ok(row!.expires.getTime() > Date.now() + 29 * 24 * 60 * 60 * 1000);
  });

  test("works once", async () => {
    const user = await scope.createUser("once", PERSONAS.nobody);
    const ticket = await mintFrameTicket(user.id);
    assert.ok(await claimFrameTicket(ticket));
    assert.equal(await claimFrameTicket(ticket), null);
  });

  test("refuses a ticket past its minute", async () => {
    const user = await scope.createUser("late", PERSONAS.nobody);
    const ticket = await mintFrameTicket(user.id);
    await db
      .update(verificationTokens)
      .set({ expires: new Date(Date.now() - 1000) })
      .where(eq(verificationTokens.identifier, `frame-signin:${user.id}`));
    assert.equal(await claimFrameTicket(ticket), null);
  });

  test("refuses a ticket it never issued", async () => {
    assert.equal(await claimFrameTicket("not-a-ticket"), null);
  });

  test("keeps only the ticket's hash", async () => {
    const user = await scope.createUser("hash", PERSONAS.nobody);
    const ticket = await mintFrameTicket(user.id);
    const rows = await db
      .select({ token: verificationTokens.token })
      .from(verificationTokens)
      .where(eq(verificationTokens.identifier, `frame-signin:${user.id}`));
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0]!.token, ticket);
  });
});

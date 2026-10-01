/**
 * Test users, sessions and events for one suite. Every id starts with
 * `TEST_PREFIX` plus the suite's scope, which is all cleanup ever deletes.
 */

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { sessions, users, workshopRuns } from "@/db/schema";
import type { Access } from "@/lib/roles";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX, assertScratchDatabase, deleteTestRows } from "./db";

export type TestUser = { id: string; email: string; access: Access };

export function testScope(name: string) {
  const scope = `${name}_`;

  /** A user holding `access`; calling it again with the same key resets them. */
  async function createUser(key: string, access: Access, email?: string): Promise<TestUser> {
    const id = `${TEST_PREFIX}${scope}${key}`;
    const address = email ?? `${scope}${key}@${TEST_EMAIL_DOMAIN}`.toLowerCase();
    const roles = {
      eventRole: access.event,
      trainingRole: access.training,
      evalsRole: access.evals,
      isPlatformAdmin: access.platform,
    };
    await db
      .insert(users)
      .values({ id, email: address, name: key, ...roles })
      .onConflictDoUpdate({ target: users.id, set: { email: address, ...roles } });
    return { id, email: address, access };
  }

  const clear = () => deleteTestRows((sql, params) => pool.query(sql, params), scope);

  return {
    createUser,
    /** Refuses anything but a scratch database, then clears what a previous run left. */
    async setUp() {
      await assertScratchDatabase(process.env.DATABASE_URL);
      await clear();
    },
    async tearDown() {
      await clear();
      await pool.end();
    },
  };
}

/** A signed-in browser session for `userId`; the value goes in the session cookie. */
export async function createSession(userId: string): Promise<string> {
  const sessionToken = `${TEST_PREFIX}${randomBytes(24).toString("hex")}`;
  await db.insert(sessions).values({
    sessionToken,
    userId,
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  return sessionToken;
}

/** An event owned by `userId`, a month out and `scheduled`, so nothing builds it. */
export async function createRun(userId: string, name: string): Promise<string> {
  const slug = `${TEST_PREFIX}${randomBytes(4).toString("hex")}`;
  const [row] = await db
    .insert(workshopRuns)
    .values({
      userId,
      name,
      slug,
      userCount: 1,
      statePrefix: `test/${slug}`,
      scheduledStart: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: workshopRuns.id });
  return row!.id;
}

export async function readRoles(id: string) {
  const [row] = await db
    .select({
      event: users.eventRole,
      training: users.trainingRole,
      evals: users.evalsRole,
      platform: users.isPlatformAdmin,
    })
    .from(users)
    .where(eq(users.id, id));
  return row ?? null;
}

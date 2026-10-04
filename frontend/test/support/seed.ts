/**
 * Test users, sessions and events for one suite. Every id starts with
 * `TEST_PREFIX` plus the suite's scope, which is all cleanup ever deletes.
 */

import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  bootcampHistory,
  bootcampJudges,
  bootcamps,
  evalsAssessmentCriteria,
  evalsAssessments,
  sessions,
  users,
  workshopRuns,
} from "@/db/schema";
import type { Access } from "@/lib/roles";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX, assertScratchDatabase, deleteTestRows } from "./db";

export type TestUser = { id: string; email: string; access: Access };

/**
 * The active bootcamp, made (and owned by `userId`, so cleanup finds it) if
 * there is none. One already there is someone else's, and is left alone.
 */
async function activeBootcampFor(userId: string): Promise<string> {
  const [active] = await db.select({ id: bootcamps.id }).from(bootcamps).where(eq(bootcamps.status, "active"));
  if (active) return active.id;
  const [made] = await db
    .insert(bootcamps)
    .values({ startDate: "2026-11-02", btcDays: 4, intDays: 3, status: "active", createdBy: userId })
    .returning({ id: bootcamps.id });
  return made!.id;
}

export function testScope(name: string) {
  const scope = `${name}_`;

  /**
   * A user holding `access`; calling it again with the same key resets them.
   * `judging` is not stored on the user, so a judge is made one on the active
   * bootcamp, which is made too if there is none.
   */
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
    if (access.judging) {
      const bootcampId = await activeBootcampFor(id);
      await db.insert(bootcampJudges).values({ bootcampId, email: address, fullName: key }).onConflictDoNothing();
    } else {
      await db.delete(bootcampJudges).where(eq(bootcampJudges.email, address));
    }
    return { id, email: address, access };
  }

  /** A bootcamp history row; its email carries the scope, so cleanup finds it. */
  async function createHistory(key: string): Promise<string> {
    const email = `${TEST_PREFIX}${scope}${key}@${TEST_EMAIL_DOMAIN}`.toLowerCase();
    const [row] = await db
      .insert(bootcampHistory)
      .values({ email, btcDate: "2026-03-02", btcScore: 3.3, btcIndividualScores: { "Score-Exams": 4 } })
      .onConflictDoUpdate({ target: bootcampHistory.email, set: { btcScore: 3.3 } })
      .returning({ id: bootcampHistory.id });
    return row!.id;
  }

  /** An active bootcamp assessment with one criterion, made by `userId` so cleanup finds it. */
  async function createAssessment(userId: string, name: string): Promise<string> {
    const [row] = await db
      .insert(evalsAssessments)
      .values({ name, stage: "bootcamp", audience: "both", active: true, createdBy: userId })
      .returning({ id: evalsAssessments.id });
    await db.insert(evalsAssessmentCriteria).values({ assessmentId: row!.id, position: 0, name: "Demo" });
    return row!.id;
  }

  /** The active bootcamp, made by `userId` if there is none. */
  const activeBootcamp = (userId: string) => activeBootcampFor(userId);

  const clear = () => deleteTestRows((sql, params) => pool.query(sql, params), scope);

  return {
    createUser,
    createHistory,
    createAssessment,
    activeBootcamp,
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

/** What `id` holds now: their stored roles, and whether they judge the active bootcamp. */
export async function readRoles(id: string) {
  const [row] = await db
    .select({
      event: users.eventRole,
      training: users.trainingRole,
      evals: users.evalsRole,
      platform: users.isPlatformAdmin,
      // Spelled out: Drizzle leaves the table off a column in a one-table query.
      judging: sql<boolean>`exists (
        select 1 from ${bootcampJudges} j join ${bootcamps} b on b.id = j.bootcamp_id
        where j.email = ${users}.email and b.status = 'active'
      )`,
    })
    .from(users)
    .where(eq(users.id, id));
  return row ?? null;
}

/**
 * Whether someone is a guest judge on the active bootcamp, which lets them
 * score on the eVals page and read that bootcamp's schedule. Read on every
 * request that builds an `Access`, so a judge loses it the moment their
 * bootcamp stops being active.
 */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bootcampJudges, bootcamps } from "@/db/schema";
import { canUseTraining, type Access } from "@/lib/roles";

export async function isJudgingNow(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const [row] = await db
    .select({ id: bootcampJudges.id })
    .from(bootcampJudges)
    .innerJoin(bootcamps, eq(bootcamps.id, bootcampJudges.bootcampId))
    .where(and(eq(bootcamps.status, "active"), eq(bootcampJudges.email, sql`lower(${email})`)))
    .limit(1);
  return Boolean(row);
}

/**
 * Whether `access` may read bootcamp `id` in the Scheduler: a Training Viewer
 * any of them, and a guest judge only the active one, which is the one they
 * judge (at most one bootcamp is active). False for anyone else, and for a
 * judge on an id that is not the active bootcamp's, whether or not it exists,
 * so a route can ask before it has parsed the id.
 */
export async function mayReadBootcamp(access: Access, id: string): Promise<boolean> {
  if (canUseTraining(access)) return true;
  if (!access.judging) return false;
  const uuid = z.string().uuid().safeParse(id);
  if (!uuid.success) return false;
  const [row] = await db
    .select({ id: bootcamps.id })
    .from(bootcamps)
    .where(and(eq(bootcamps.id, uuid.data), eq(bootcamps.status, "active")))
    .limit(1);
  return Boolean(row);
}

/**
 * Whether someone is a guest judge on the active bootcamp, which lets them
 * score on the eVals page. Read on every request that builds an `Access`, so
 * a judge loses it the moment their bootcamp stops being active.
 */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bootcampJudges, bootcamps } from "@/db/schema";

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

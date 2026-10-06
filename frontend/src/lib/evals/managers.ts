/**
 * Whether someone manages people: the last HiBob sync has anyone reporting
 * to them. Not a role — nobody grants it — so it is read on every request
 * that builds an `Access`, like judging, and follows HiBob the moment a sync
 * moves someone's reports.
 */

import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";

export async function isManagerNow(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.reportsToEmail, sql`lower(${email})`))
    .limit(1);
  return Boolean(row);
}

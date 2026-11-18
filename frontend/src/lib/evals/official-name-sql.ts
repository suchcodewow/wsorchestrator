import "server-only";
import { sql } from "drizzle-orm";
import { employees } from "@/db/schema";

/**
 * The name HiBob has for an employee (`employees.raw`), which keeps the first
 * name they replaced with a preferred one. Searches list it beside
 * `employees.fullName`, so a search for either first name finds them.
 */
export const officialNameSql = sql`${employees.raw}->>'fullName'`;

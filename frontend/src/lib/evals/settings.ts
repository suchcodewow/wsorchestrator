/** eVals-wide settings: for now, just the Organization Leader. */

import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, EVALS_SETTINGS_KEYS, evalsSettings } from "@/db/schema";
import { ORG_ROOT_EMAIL } from "@/lib/evals/org";

/** The configured org leader, or the default root if none has been set. */
export async function getOrgLeaderEmail(): Promise<string> {
  const [row] = await db
    .select({ value: evalsSettings.value })
    .from(evalsSettings)
    .where(eq(evalsSettings.key, EVALS_SETTINGS_KEYS.orgLeaderEmail));
  return row?.value ?? ORG_ROOT_EMAIL;
}

export type SetOrgLeaderError = "not_an_employee";

/** The leader must be someone the last HiBob sync actually imported. */
export async function setOrgLeaderEmail(
  actorId: string,
  email: string,
): Promise<{ ok: true } | { ok: false; error: SetOrgLeaderError }> {
  const lower = email.trim().toLowerCase();
  const [employee] = await db
    .select({ email: employees.email })
    .from(employees)
    .where(eq(employees.email, lower));
  if (!employee) return { ok: false, error: "not_an_employee" };

  await db
    .insert(evalsSettings)
    .values({ key: EVALS_SETTINGS_KEYS.orgLeaderEmail, value: lower, updatedBy: actorId })
    .onConflictDoUpdate({
      target: evalsSettings.key,
      set: { value: lower, updatedBy: actorId, updatedAt: new Date() },
    });
  return { ok: true };
}

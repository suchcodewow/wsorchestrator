/** eVals-wide settings: the Organization Leader and the candidate date cutoffs. */

import "server-only";

import { eq, inArray, sql } from "drizzle-orm";
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

/**
 * Who in the org is recent enough to be a candidate, as `YYYY-MM-DD` days;
 * null turns a cutoff off. The Google Sheet this replaced had both
 * hard-coded in `populateCandidates`, and they read the same way here: a
 * blank HiBob start date passes, a blank active effective date does not.
 */
export type CandidateCutoffs = {
  /** HiBob's `work.startDate`, the first day at the company, on or after this day. */
  startDateOnOrAfter: string | null;
  /** HiBob's `work.activeEffectiveDate`, when the current position took effect, after this day. */
  activeEffectiveDateAfter: string | null;
};

/** What the Google Sheet used, until someone saves otherwise. */
export const DEFAULT_CANDIDATE_CUTOFFS: CandidateCutoffs = {
  startDateOnOrAfter: "2025-04-01",
  activeEffectiveDateAfter: "2026-01-01",
};

const CUTOFF_FIELDS = ["startDateOnOrAfter", "activeEffectiveDateAfter"] as const;

/** The saved cutoffs; a setting never saved takes its default, one saved empty is off. */
export async function getCandidateCutoffs(): Promise<CandidateCutoffs> {
  const rows = await db
    .select({ key: evalsSettings.key, value: evalsSettings.value })
    .from(evalsSettings)
    .where(inArray(evalsSettings.key, CUTOFF_FIELDS.map((f) => EVALS_SETTINGS_KEYS[f])));
  const saved = new Map(rows.map((r) => [r.key, r.value]));
  const cutoffs = { ...DEFAULT_CANDIDATE_CUTOFFS };
  for (const field of CUTOFF_FIELDS) {
    const value = saved.get(EVALS_SETTINGS_KEYS[field]);
    if (value !== undefined) cutoffs[field] = value || null;
  }
  return cutoffs;
}

/** Saves whichever cutoffs are given, each a validated `YYYY-MM-DD` or null for off. */
export async function setCandidateCutoffs(actorId: string, changes: Partial<CandidateCutoffs>): Promise<void> {
  const values = CUTOFF_FIELDS.filter((f) => changes[f] !== undefined).map((f) => ({
    key: EVALS_SETTINGS_KEYS[f],
    value: changes[f] ?? "",
    updatedBy: actorId,
  }));
  if (values.length === 0) return;
  await db
    .insert(evalsSettings)
    .values(values)
    .onConflictDoUpdate({
      target: evalsSettings.key,
      set: { value: sql`excluded.value`, updatedBy: actorId, updatedAt: new Date() },
    });
}

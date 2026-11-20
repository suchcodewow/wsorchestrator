/**
 * Which optional sections a person's Live Sessions page shows: their
 * Diagnostic placements and their Coach Canary progress. Both are off until
 * someone turns them on, in Reporting Settings → Live Sessions Settings.
 */

import "server-only";

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { EVALS_SETTINGS_KEYS, evalsSettings } from "@/db/schema";

export type LiveSessionsSettings = { diagnostic: boolean; coachCanary: boolean };

export async function getLiveSessionsSettings(): Promise<LiveSessionsSettings> {
  const { liveSessionsDiagnostic, liveSessionsCoachCanary } = EVALS_SETTINGS_KEYS;
  const rows = await db
    .select({ key: evalsSettings.key, value: evalsSettings.value })
    .from(evalsSettings)
    .where(inArray(evalsSettings.key, [liveSessionsDiagnostic, liveSessionsCoachCanary]));
  const on = (key: string) => rows.find((r) => r.key === key)?.value === "true";
  return { diagnostic: on(liveSessionsDiagnostic), coachCanary: on(liveSessionsCoachCanary) };
}

export async function setLiveSessionsSettings(actorId: string, change: Partial<LiveSessionsSettings>): Promise<void> {
  const entries = [
    [EVALS_SETTINGS_KEYS.liveSessionsDiagnostic, change.diagnostic],
    [EVALS_SETTINGS_KEYS.liveSessionsCoachCanary, change.coachCanary],
  ] as const;
  for (const [key, on] of entries) {
    if (on === undefined) continue;
    const value = on ? "true" : "false";
    await db
      .insert(evalsSettings)
      .values({ key, value, updatedBy: actorId })
      .onConflictDoUpdate({ target: evalsSettings.key, set: { value, updatedBy: actorId, updatedAt: new Date() } });
  }
}

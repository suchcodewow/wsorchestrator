/**
 * What each person has told Coach Canary about themselves: their role, how
 * they like to be coached and whose voice the coach speaks in. The map coach
 * reads it on every turn. Everyone's is their own; nobody reads anyone else's.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  MIMIR_COACH_PERSONALITIES,
  MIMIR_COACH_STYLES,
  MIMIR_REP_ROLES,
  mimirProfiles,
  type MimirCoachPersonality,
  type MimirCoachStyle,
  type MimirRepRole,
} from "@/db/schema";

export type MimirProfile = { role: MimirRepRole | null; coachStyle: MimirCoachStyle; coachPersonality: MimirCoachPersonality };

export async function getProfile(userId: string): Promise<MimirProfile> {
  const [row] = await db
    .select({ role: mimirProfiles.role, coachStyle: mimirProfiles.coachStyle, coachPersonality: mimirProfiles.coachPersonality })
    .from(mimirProfiles)
    .where(eq(mimirProfiles.userId, userId));
  return row ?? { role: null, coachStyle: "socratic", coachPersonality: "canary" };
}

/** A personality left out is left as it was, so a caller that only knows the role and style keeps working. */
export const profileSchema = z.object({
  role: z.enum(MIMIR_REP_ROLES).nullable(),
  coachStyle: z.enum(MIMIR_COACH_STYLES),
  coachPersonality: z.enum(MIMIR_COACH_PERSONALITIES).optional(),
});

/** Saves it; the coach uses it from its next reply. */
export async function setProfile(userId: string, profile: z.infer<typeof profileSchema>): Promise<void> {
  await db
    .insert(mimirProfiles)
    .values({ userId, ...profile })
    .onConflictDoUpdate({ target: mimirProfiles.userId, set: { ...profile, updatedAt: new Date() } });
}

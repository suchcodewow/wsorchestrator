/**
 * Reading and saving each Training game's setup. A game with no saved row
 * plays its defaults, and so does one whose saved setup no longer parses.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { trainingGames, users } from "@/db/schema";
import { DEFAULT_GUESS_WHO, guessWhoConfigSchema, type GuessWhoConfig } from "@/lib/games/guess-who";

export const GUESS_WHO_KEY = "guess_who";

export type GuessWhoSettings = {
  config: GuessWhoConfig;
  /** When it was last saved and by whom; null while it is the defaults. */
  updatedAt: Date | null;
  updatedBy: string | null;
};

export async function getGuessWho(): Promise<GuessWhoSettings> {
  const [row] = await db
    .select({ config: trainingGames.config, updatedAt: trainingGames.updatedAt, updatedBy: users.name })
    .from(trainingGames)
    .leftJoin(users, eq(users.id, trainingGames.updatedBy))
    .where(eq(trainingGames.key, GUESS_WHO_KEY))
    .limit(1);
  const parsed = row ? guessWhoConfigSchema.safeParse(row.config) : null;
  if (!row || !parsed?.success) return { config: DEFAULT_GUESS_WHO, updatedAt: null, updatedBy: null };
  return { config: parsed.data, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
}

export async function setGuessWho(actorId: string, config: GuessWhoConfig): Promise<void> {
  const now = new Date();
  await db
    .insert(trainingGames)
    .values({ key: GUESS_WHO_KEY, config, updatedBy: actorId, updatedAt: now })
    .onConflictDoUpdate({ target: trainingGames.key, set: { config, updatedBy: actorId, updatedAt: now } });
}

/** Back to the defaults: the saved setup is removed. */
export async function resetGuessWho(): Promise<void> {
  await db.delete(trainingGames).where(eq(trainingGames.key, GUESS_WHO_KEY));
}

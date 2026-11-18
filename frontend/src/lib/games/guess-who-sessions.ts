/**
 * Guess Who shared with the room. The facilitator opens a game to reps; from
 * then on the game lives here, and every screen on it (the facilitator's and
 * each rep's) reads it back about once a second. Reps reach it by one fixed
 * link, `/guess-who`, so only one game is shared at a time: sharing a game
 * ends any other. Each game still has a code, which the facilitator's screen
 * and the API name it by. Each move is applied in a transaction that holds
 * the row, so two reps flipping at once both land and `rev` goes up once for
 * each.
 */

import "server-only";

import { randomInt } from "node:crypto";
import { desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { guessWhoSessions } from "@/db/schema";
import { GUESS_WHO_LIMITS, guessWhoConfigSchema, type GuessWhoConfig } from "@/lib/games/guess-who";
import { freshGame, gameStateSchema, makeReducer, type GameAction, type GameState } from "@/lib/games/guess-who-play";

/** No 0/O, 1/I/L, so a code read off a slide or a Slack message is typed right. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = GUESS_WHO_LIMITS.codeLength;
const CODE = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

export type SharedGame = { code: string; config: GuessWhoConfig; state: GameState; rev: number };

/** A code as someone typed it, upper-cased and checked; null when it can't be one. */
export function normalizeCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

function newCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

function parse(row: { code: string; config: unknown; state: unknown; rev: number }): SharedGame | null {
  const config = guessWhoConfigSchema.safeParse(row.config);
  const state = gameStateSchema.safeParse(row.state);
  if (!config.success || !state.success) return null;
  return { code: row.code, config: config.data, state: state.data, rev: row.rev };
}

/**
 * Opens a game to the room with the setup it is played with, and ends any
 * other shared game: its facilitator's screen carries on with it unshared. A
 * `state` from the facilitator's browser carries on a game already under way;
 * one that doesn't fit the setup starts round 1 instead.
 */
export async function shareGame(actorId: string, config: GuessWhoConfig, version: string, state?: unknown): Promise<SharedGame> {
  const parsed = gameStateSchema.safeParse(state);
  const start =
    parsed.success && parsed.data.version === version && parsed.data.round < config.rounds.length
      ? parsed.data
      : freshGame(version);
  for (let attempt = 0; ; attempt++) {
    const code = newCode();
    const [row] = await db
      .insert(guessWhoSessions)
      .values({ code, config, state: start, createdBy: actorId })
      .onConflictDoNothing()
      .returning({ code: guessWhoSessions.code });
    if (row) {
      await db.delete(guessWhoSessions).where(ne(guessWhoSessions.code, code));
      return { code, config, state: start, rev: 0 };
    }
    if (attempt >= 5) throw new Error("could not find a free Guess Who code");
  }
}

/** The game reps reach at `/guess-who`: the one shared last, or null when none is. */
export async function getCurrentSharedGame(): Promise<SharedGame | null> {
  const [row] = await db
    .select({ code: guessWhoSessions.code, config: guessWhoSessions.config, state: guessWhoSessions.state, rev: guessWhoSessions.rev })
    .from(guessWhoSessions)
    .orderBy(desc(guessWhoSessions.createdAt))
    .limit(1);
  return row ? parse(row) : null;
}

export async function getSharedGame(code: string): Promise<SharedGame | null> {
  const [row] = await db
    .select({ code: guessWhoSessions.code, config: guessWhoSessions.config, state: guessWhoSessions.state, rev: guessWhoSessions.rev })
    .from(guessWhoSessions)
    .where(eq(guessWhoSessions.code, code))
    .limit(1);
  return row ? parse(row) : null;
}

/**
 * Applies one move to a shared game and returns the game after it. A move the
 * rules turn down (a flip on a finished board, say) changes nothing and leaves
 * `rev` where it was. Null when there is no such game.
 */
export async function playSharedGame(code: string, action: Exclude<GameAction, { type: "load" }>): Promise<SharedGame | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ code: guessWhoSessions.code, config: guessWhoSessions.config, state: guessWhoSessions.state, rev: guessWhoSessions.rev })
      .from(guessWhoSessions)
      .where(eq(guessWhoSessions.code, code))
      .limit(1)
      .for("update");
    const game = row ? parse(row) : null;
    if (!game) return null;

    const next = makeReducer(game.config)(game.state, action);
    if (next === game.state) return game;

    const [saved] = await tx
      .update(guessWhoSessions)
      .set({ state: next, rev: sql`${guessWhoSessions.rev} + 1`, updatedAt: new Date() })
      .where(eq(guessWhoSessions.code, code))
      .returning({ rev: guessWhoSessions.rev });
    return { ...game, state: next, rev: saved!.rev };
  });
}

/** Ends a shared game: its link stops working. True when there was one. */
export async function endSharedGame(code: string): Promise<boolean> {
  const rows = await db.delete(guessWhoSessions).where(eq(guessWhoSessions.code, code)).returning({ code: guessWhoSessions.code });
  return rows.length > 0;
}

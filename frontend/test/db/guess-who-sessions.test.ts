/**
 * Guess Who shared with the room, against a real database. Reps reach the
 * game by one fixed link, so sharing a game must end any other: otherwise a
 * game someone forgot to stop comes back as the room's game when the newest
 * one ends. And two reps flipping at once must both land.
 *
 * Sharing empties `guess_who_sessions` of every other game, so the table is
 * saved before and put back after; the scratch database may hold someone's
 * game. The suite's own user is deleted by its id.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { guessWhoSessions, users } from "@/db/schema";
import { DEFAULT_GUESS_WHO } from "@/lib/games/guess-who";
import {
  endSharedGame,
  getCurrentSharedGame,
  getSharedGame,
  playSharedGame,
  shareGame,
} from "@/lib/games/guess-who-sessions";

const USER = "test-guess-who-sessions";
let saved: (typeof guessWhoSessions.$inferSelect)[] = [];

before(async () => {
  saved = await db.select().from(guessWhoSessions);
  await db.insert(users).values({ id: USER, name: "Guess Who test", email: "guess-who-sessions@example.test" }).onConflictDoNothing();
});

after(async () => {
  await db.delete(guessWhoSessions);
  if (saved.length) await db.insert(guessWhoSessions).values(saved);
  await db.delete(users).where(eq(users.id, USER));
});

describe("sharing a Guess Who game", () => {
  test("ends the game shared before it, so the fixed link has only the new one", async () => {
    const first = await shareGame(USER, DEFAULT_GUESS_WHO, "v1");
    const second = await shareGame(USER, DEFAULT_GUESS_WHO, "v1");
    assert.notEqual(first.code, second.code);
    assert.equal(await getSharedGame(first.code), null);
    assert.equal((await getCurrentSharedGame())?.code, second.code);

    assert.equal(await endSharedGame(second.code), true);
    assert.equal(await getCurrentSharedGame(), null);
  });

  test("carries on a game under way, and starts over one from another setup", async () => {
    const tool = DEFAULT_GUESS_WHO.tools[0]!.id;
    const under = await shareGame(USER, DEFAULT_GUESS_WHO, "v1");
    const moved = await playSharedGame(under.code, { type: "flip", team: "red", id: tool, down: true });
    const kept = await shareGame(USER, DEFAULT_GUESS_WHO, "v1", moved!.state);
    assert.deepEqual(kept.state.sides.red.down, [tool]);
    const other = await shareGame(USER, DEFAULT_GUESS_WHO, "v2", moved!.state);
    assert.deepEqual(other.state.sides.red.down, []);
  });

  test("two reps flipping at once both land, one revision each", async () => {
    const game = await shareGame(USER, DEFAULT_GUESS_WHO, "v1");
    const [a, b] = DEFAULT_GUESS_WHO.tools.map((t) => t.id);
    await Promise.all([
      playSharedGame(game.code, { type: "flip", team: "blue", id: a!, down: true }),
      playSharedGame(game.code, { type: "flip", team: "blue", id: b!, down: true }),
    ]);
    const now = await getSharedGame(game.code);
    assert.deepEqual([...now!.state.sides.blue.down].sort(), [a, b].sort());
    assert.equal(now!.rev, 2);
  });
});

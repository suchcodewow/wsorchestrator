/**
 * Guess Who's rules once reps flip their own team's cards: a flip lands on
 * the board it names whoever's turn it is, says what it wants ("down", not
 * "toggle") so two reps tapping one card agree, and keeps off a board whose
 * guess the room is watching. The facilitator's moves are as they were.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GUESS_WHO } from "@/lib/games/guess-who";
import { canFlip, freshGame, gameActionSchema, gameStateSchema, makeReducer, type GameState } from "@/lib/games/guess-who-play";

const config = DEFAULT_GUESS_WHO;
const reduce = makeReducer(config);
const start = () => freshGame("v1");
const [a, b] = [config.tools[0]!.id, config.tools[1]!.id];

describe("flips", () => {
  test("land on the board named, on either team's turn", () => {
    const s = reduce(start(), { type: "flip", team: "blue", id: a, down: true });
    assert.equal(s.turn, "red");
    assert.deepEqual(s.sides.blue.down, [a]);
    assert.deepEqual(s.sides.red.down, []);
  });

  test("two reps knocking down the same card leave it down, and the second changes nothing", () => {
    const once = reduce(start(), { type: "flip", team: "red", id: a, down: true });
    const twice = reduce(once, { type: "flip", team: "red", id: a, down: true });
    assert.equal(twice, once);
    assert.deepEqual(twice.sides.red.down, [a]);
  });

  test("a card knocked down and stood back up before the turn ends leaves no trace in the recap", () => {
    let s = reduce(start(), { type: "flip", team: "red", id: a, down: true });
    s = reduce(s, { type: "flip", team: "red", id: b, down: true });
    s = reduce(s, { type: "flip", team: "red", id: a, down: false });
    s = reduce(s, { type: "endTurn" });
    assert.deepEqual(s.sides.red.log, [{ kind: "question", down: [b], up: [] }]);
  });

  test("an unknown card is ignored", () => {
    const s = start();
    assert.equal(reduce(s, { type: "flip", team: "red", id: "not-a-tool", down: true }), s);
  });

  test("keep off the board whose guess is on show, but not the other team's", () => {
    let s = reduce(start(), { type: "guessMode", on: true });
    s = reduce(s, { type: "guess", id: a });
    assert.ok(s.pending);
    assert.equal(canFlip(s, "red"), false);
    assert.equal(reduce(s, { type: "flip", team: "red", id: b, down: true }), s);
    const blue = reduce(s, { type: "flip", team: "blue", id: b, down: true });
    assert.deepEqual(blue.sides.blue.down, [b]);
  });

  test("a wrong guess on a card a rep already knocked down doesn't count it twice", () => {
    const wrong = config.tools.find((t) => t.id !== config.rounds[0]!.red)!.id;
    let s = reduce(start(), { type: "guessMode", on: true });
    s = reduce(s, { type: "guess", id: wrong });
    // Not possible from the guess itself, which refuses a card down; only a flip on the blue board can slip in.
    s = { ...s, sides: { ...s.sides, red: { ...s.sides.red, down: [wrong] } } } as GameState;
    s = reduce(s, { type: "resolveGuess" });
    assert.deepEqual(s.sides.red.down, [wrong]);
  });

  test("stop once a board is finished", () => {
    let s = reduce(start(), { type: "guessMode", on: true });
    s = reduce(s, { type: "guess", id: config.rounds[0]!.red });
    s = reduce(s, { type: "resolveGuess" });
    assert.equal(s.sides.red.status, "solved");
    assert.equal(canFlip(s, "red"), false);
  });
});

describe("what the server accepts", () => {
  test("a game the browser hands over parses back as it was", () => {
    const s = reduce(start(), { type: "flip", team: "red", id: a, down: true });
    assert.deepEqual(gameStateSchema.parse(JSON.parse(JSON.stringify(s))), s);
  });

  test("the browser's own load is not a move", () => {
    assert.equal(gameActionSchema.safeParse({ type: "load", state: start() }).success, false);
    assert.equal(gameActionSchema.safeParse({ type: "adjust", team: "red", by: 5 }).success, false);
    assert.equal(gameActionSchema.safeParse({ type: "endTurn" }).success, true);
  });
});

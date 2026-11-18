/**
 * Guess Who's play: the state of a game and the rules that move it on. The
 * facilitator's screen runs these in the browser, and the server runs the same
 * ones on a shared game (`guess-who-sessions.ts`), so a rep's flip and the
 * facilitator's turn land in one state. Safe to import in the browser.
 */

import { z } from "zod";
import { TEAMS, type GuessWhoConfig, type Team } from "@/lib/games/guess-who";

export type Log = { kind: "question"; down: string[]; up: string[] } | { kind: "guess"; tool: string; correct: boolean };

export type Side = {
  down: string[];
  questions: number;
  /** The facilitator's correction to this round's score, in questions. */
  adjust: number;
  status: "playing" | "solved" | "capped";
  log: Log[];
  /** Cards knocked down or stood up since the team's turn began. */
  turnDown: string[];
  turnUp: string[];
};

export type GameState = {
  version: string;
  round: number;
  turn: Team;
  phase: "playing" | "recap" | "final";
  guessing: boolean;
  sides: Record<Team, Side>;
  /** Each finished round's score per team. */
  results: Record<Team, number>[];
  /**
   * A guess the room is watching land: shown for a beat (the card shakes or
   * grows, a banner says whether it is right) before `resolveGuess` applies
   * it. Only flips on the other team's board get through while it is set.
   */
  pending?: { team: Team; id: string; correct: boolean };
};

/** A card knocked down (`down: true`) or stood back up on one team's board, by anyone on that team. */
export type FlipAction = { type: "flip"; team: Team; id: string; down: boolean };

/** What the facilitator does. `load` is the browser's own, never sent to the server. */
export type GameAction =
  | FlipAction
  | { type: "endTurn" }
  | { type: "guessMode"; on: boolean }
  | { type: "guess"; id: string }
  | { type: "resolveGuess" }
  | { type: "adjust"; team: Team; by: number }
  | { type: "nextRound" }
  | { type: "restart" }
  | { type: "load"; state: GameState };

export const OTHER: Record<Team, Team> = { red: "blue", blue: "red" };

const freshSide = (): Side => ({ down: [], questions: 0, adjust: 0, status: "playing", log: [], turnDown: [], turnUp: [] });
/** Red starts the first round, and the start alternates after. */
const firstTeam = (round: number): Team => (round % 2 === 0 ? "red" : "blue");
export const roundScore = (s: Side) => Math.max(0, s.questions + s.adjust);

export function freshGame(version: string, round = 0, results: GameState["results"] = []): GameState {
  return {
    version,
    round,
    turn: firstTeam(round),
    phase: "playing",
    guessing: false,
    sides: { red: freshSide(), blue: freshSide() },
    results,
  };
}

/** May this team's board be flipped now? Any time in a round, except its own board while its guess is on show. */
export function canFlip(state: GameState, team: Team): boolean {
  return state.phase === "playing" && state.sides[team].status === "playing" && state.pending?.team !== team;
}

export function makeReducer(config: GuessWhoConfig) {
  const toolIds = new Set(config.tools.map((t) => t.id));

  /** After a turn: pass to the other team while it is still playing, and end the round once neither is. */
  function afterTurn(state: GameState, team: Team, side: Side): GameState {
    let s: Side = side;
    if (s.status === "playing" && s.questions >= config.questionCap) s = { ...s, status: "capped" };
    const sides = { ...state.sides, [team]: s };
    const other = OTHER[team];
    if (s.status !== "playing" && sides[other].status !== "playing") {
      return { ...state, sides, guessing: false, phase: "recap" };
    }
    const turn = sides[other].status === "playing" ? other : team;
    return { ...state, sides, guessing: false, turn };
  }

  /** Applies the pending guess: the turn it took, and either the solve or the card it rules out. */
  function resolve(state: GameState): GameState {
    const p = state.pending;
    if (!p) return state;
    const team = p.team;
    const side = state.sides[team];
    const mystery = config.rounds[state.round]![team];
    const log: Log[] = [...side.log];
    // Knockdowns made before the guess still count as that turn's.
    if (side.turnDown.length || side.turnUp.length) log.push({ kind: "question", down: side.turnDown, up: side.turnUp });
    log.push({ kind: "guess", tool: p.id, correct: p.correct });
    const next: Side = {
      ...side,
      questions: side.questions + 1,
      log,
      turnDown: [],
      turnUp: [],
      status: p.correct ? "solved" : side.status,
      down: p.correct
        ? config.tools.map((t) => t.id).filter((id) => id !== mystery)
        : side.down.includes(p.id)
          ? side.down
          : [...side.down, p.id],
    };
    return afterTurn({ ...state, pending: undefined }, team, next);
  }

  function flip(state: GameState, { team, id, down }: FlipAction): GameState {
    if (!toolIds.has(id) || !canFlip(state, team)) return state;
    const side = state.sides[team];
    if (side.down.includes(id) === down) return state;
    const without = (list: string[]) => list.filter((d) => d !== id);
    let { turnDown, turnUp } = side;
    // A card knocked down and stood back up in the same turn (or the reverse) leaves no trace.
    if (down) {
      if (turnUp.includes(id)) turnUp = without(turnUp);
      else turnDown = [...turnDown, id];
      return { ...state, sides: { ...state.sides, [team]: { ...side, down: [...side.down, id], turnDown, turnUp } } };
    }
    if (turnDown.includes(id)) turnDown = without(turnDown);
    else turnUp = [...turnUp, id];
    return { ...state, sides: { ...state.sides, [team]: { ...side, down: without(side.down), turnDown, turnUp } } };
  }

  return function reduce(state: GameState, action: GameAction): GameState {
    if (action.type === "flip") return flip(state, action);
    // While a guess is on show, only its own resolution, a restart or a load gets through.
    if (state.pending && !["resolveGuess", "restart", "load"].includes(action.type)) return state;
    const team = state.turn;
    const side = state.sides[team];
    switch (action.type) {
      case "endTurn": {
        if (state.phase !== "playing" || side.status !== "playing") return state;
        const next: Side = {
          ...side,
          questions: side.questions + 1,
          log: [...side.log, { kind: "question", down: side.turnDown, up: side.turnUp }],
          turnDown: [],
          turnUp: [],
        };
        return afterTurn(state, team, next);
      }
      case "guessMode":
        if (state.phase !== "playing" || side.status !== "playing") return state;
        return { ...state, guessing: action.on };
      case "guess": {
        if (state.phase !== "playing" || side.status !== "playing" || !state.guessing) return state;
        if (!toolIds.has(action.id) || side.down.includes(action.id)) return state;
        const correct = action.id === config.rounds[state.round]![team];
        return { ...state, guessing: false, pending: { team, id: action.id, correct } };
      }
      case "resolveGuess":
        return resolve(state);
      case "adjust": {
        if (state.phase === "final") return state;
        const s = state.sides[action.team];
        return { ...state, sides: { ...state.sides, [action.team]: { ...s, adjust: s.adjust + action.by } } };
      }
      case "nextRound": {
        if (state.phase !== "recap") return state;
        const results = [...state.results, { red: roundScore(state.sides.red), blue: roundScore(state.sides.blue) }];
        if (state.round + 1 >= config.rounds.length) return { ...state, results, phase: "final" };
        return freshGame(state.version, state.round + 1, results);
      }
      case "restart":
        return freshGame(state.version);
      case "load":
        // A guess left on show when the page closed is simply applied.
        return resolve(action.state);
    }
  };
}

/* ------------------------------------------------------------------ */
/* What the server accepts                                             */
/* ------------------------------------------------------------------ */

const team = z.enum(TEAMS);
const id = z.string().max(40);
const ids = z.array(id).max(60);

const sideSchema = z.object({
  down: ids,
  questions: z.number().int().min(0).max(1000),
  adjust: z.number().int().min(-1000).max(1000),
  status: z.enum(["playing", "solved", "capped"]),
  log: z
    .array(
      z.union([
        z.object({ kind: z.literal("question"), down: ids, up: ids }),
        z.object({ kind: z.literal("guess"), tool: id, correct: z.boolean() }),
      ]),
    )
    .max(200),
  turnDown: ids,
  turnUp: ids,
});

/** A game the facilitator's browser hands over when it starts sharing, so play carries on where it was. */
export const gameStateSchema = z.object({
  version: z.string().max(100),
  round: z.number().int().min(0).max(20),
  turn: team,
  phase: z.enum(["playing", "recap", "final"]),
  guessing: z.boolean(),
  sides: z.object({ red: sideSchema, blue: sideSchema }),
  results: z.array(z.object({ red: z.number().int(), blue: z.number().int() })).max(20),
  pending: z.object({ team, id, correct: z.boolean() }).optional(),
});

export const flipSchema = z.object({ team, tool: id, down: z.boolean() });

/** The facilitator's moves on a shared game: everything but `load`, which only the browser makes. */
export const gameActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("flip"), team, id, down: z.boolean() }),
  z.object({ type: z.literal("endTurn") }),
  z.object({ type: z.literal("guessMode"), on: z.boolean() }),
  z.object({ type: z.literal("guess"), id }),
  z.object({ type: z.literal("resolveGuess") }),
  z.object({ type: z.literal("adjust"), team, by: z.number().int().min(-1).max(1) }),
  z.object({ type: z.literal("nextRound") }),
  z.object({ type: z.literal("restart") }),
]);

export type SharedAction = z.infer<typeof gameActionSchema>;

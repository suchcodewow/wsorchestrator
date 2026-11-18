/** Training → Games: each game's setup. */

import { GUESS_WHO_LIMITS } from "@/lib/games/guess-who";
import type { EndpointGroup } from "./types";

const TOOL_SHAPE = "{ id, name }";
const CODE_LENGTH = GUESS_WHO_LIMITS.codeLength;
const SHARED = "{ code: string, config: { tools, rounds, questionCap }, state: GameState, rev: number }";

export const GAMES_GROUPS: EndpointGroup[] = [
  {
    id: "training-games",
    title: "Games",
    intro:
      "The setup of each live review game a facilitator runs in front of the room, and the games a facilitator has shared with the room. Games are for Training Administrators only, except that anyone with a shared game's code may read it and flip its cards. A game that isn't shared is played in the facilitator's browser and not stored.",
    endpoints: [
      {
        method: "GET",
        path: "/api/games/guess-who",
        summary: "Returns Guess Who's setup: the tool cards on the board, each round's mystery tools, and the question cap.",
        access: "trainingAdmin",
        token: true,
        notes:
          "Until a Training Administrator saves a setup, the defaults drawn from the Who serves the SDLC deck are returned, with updatedAt and updatedBy null. Every round's red and blue name the id of a tool in tools. The game knows only each tool's name; the facilitator answers the room's questions about it.",
        returns: `{ tools: ${TOOL_SHAPE}[], rounds: { red: string, blue: string }[], questionCap: number, updatedAt: ISO 8601 string | null, updatedBy: string | null }`,
      },
      {
        method: "PUT",
        path: "/api/games/guess-who",
        summary: "Saves Guess Who's whole setup, replacing the one before.",
        access: "trainingAdmin",
        token: true,
        notes: `A game already under way on someone's screen keeps the setup it started with until it is restarted. Tool ids are lowercase letters, digits and hyphens, unique on the board.`,
        body: {
          kind: "json",
          fields: [
            {
              name: "tools",
              type: `${TOOL_SHAPE}[]`,
              required: true,
              note: `${GUESS_WHO_LIMITS.toolsMin} to ${GUESS_WHO_LIMITS.toolsMax}; name up to ${GUESS_WHO_LIMITS.nameMax} characters`,
            },
            {
              name: "rounds",
              type: "{ red: string, blue: string }[]",
              required: true,
              note: `1 to ${GUESS_WHO_LIMITS.roundsMax}; each a tool id from tools`,
            },
            { name: "questionCap", type: "integer", required: true, note: `${GUESS_WHO_LIMITS.capMin} to ${GUESS_WHO_LIMITS.capMax}` },
          ],
        },
        returns: "{ ok: true }",
        errors: [
          {
            status: 400,
            error: "invalid",
            when: "the body does not parse, a tool id repeats, or a round names a tool not in tools; issues lists each problem's path",
          },
        ],
      },
      {
        method: "DELETE",
        path: "/api/games/guess-who",
        summary: "Removes the saved setup, so Guess Who plays the defaults again.",
        access: "trainingAdmin",
        token: true,
        returns: "{ ok: true }",
      },
      {
        method: "POST",
        path: "/api/games/guess-who/sessions",
        summary: "Shares a Guess Who game with the room: reps open /guess-who, pick Red or Blue, and flip that team's cards from their own laptops.",
        access: "trainingAdmin",
        token: true,
        notes: `One game is shared at a time, since reps reach it by one fixed link: sharing a game ends any other, whose facilitator's screen carries on with it unshared. The game keeps the setup saved when it was shared, whatever settings change after. A state from the facilitator's screen carries on a game under way; without one, or with one from a different setup, it starts at round 1. Each game has a code of ${CODE_LENGTH} letters and digits that the other endpoints name it by; it doesn't expire.`,
        body: {
          kind: "json",
          fields: [{ name: "state", type: "GameState", required: false, note: "the game as the facilitator's screen holds it" }],
        },
        returns: `201 ${SHARED}`,
      },
      {
        method: "GET",
        path: "/api/games/guess-who/sessions/current",
        summary: "Returns the game being shared, the one reps reach at /guess-who.",
        access: "public",
        token: true,
        notes: "The reps' page reads this about once a second, so it moves on to a new game as soon as one is shared. Its code names the game for flips.",
        returns: SHARED,
        errors: [{ status: 404, error: "not_found", when: "no game is being shared" }],
      },
      {
        method: "GET",
        path: "/api/games/guess-who/sessions/{code}",
        summary: "Returns a shared game as it stands: its setup, its play and its revision.",
        access: "public",
        token: true,
        notes:
          "Every screen on the game reads this about once a second; rev goes up by one with each change, so a screen behind it takes the new state. The setup includes each round's mystery tools.",
        params: [{ name: "code", type: "string", required: true, note: "case doesn't matter" }],
        returns: SHARED,
        errors: [{ status: 404, error: "not_found", when: "no game has that code, or it was ended" }],
      },
      {
        method: "POST",
        path: "/api/games/guess-who/sessions/{code}/flips",
        summary: "Knocks a card down on one team's board, or stands it back up.",
        access: "public",
        token: true,
        notes:
          "Anyone with the code may flip either team's cards, at any time in a round, except on a board whose guess is on show or that has finished the round. A flip that changes nothing, such as knocking down a card already down, leaves rev as it was. Each is recorded in the audit trail with no one named.",
        params: [{ name: "code", type: "string", required: true }],
        body: {
          kind: "json",
          fields: [
            { name: "team", type: '"red" | "blue"', required: true },
            { name: "tool", type: "string", required: true, note: "a tool id from the game's setup" },
            { name: "down", type: "boolean", required: true, note: "true knocks it down, false stands it up" },
          ],
        },
        returns: SHARED,
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse" },
          { status: 404, error: "not_found", when: "no game has that code" },
        ],
      },
      {
        method: "POST",
        path: "/api/games/guess-who/sessions/{code}/moves",
        summary: "Makes one of the facilitator's moves on a shared game.",
        access: "trainingAdmin",
        token: true,
        notes:
          'type is one of flip (with team, id and down), endTurn, guessMode (with on), guess (with id, a card on the board of the team whose turn it is), resolveGuess (applies a guess once the room has seen it), adjust (with team and by, -1 or 1), nextRound or restart. A move the rules turn down changes nothing and leaves rev as it was.',
        params: [{ name: "code", type: "string", required: true }],
        body: { kind: "json", fields: [{ name: "type", type: "string", required: true, note: "and that move's own fields" }] },
        returns: SHARED,
        errors: [
          { status: 400, error: "invalid", when: "the body is not a move" },
          { status: 404, error: "not_found", when: "no game has that code" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/games/guess-who/sessions/{code}",
        summary: "Ends a shared game, so /guess-who has none until another is shared.",
        access: "trainingAdmin",
        token: true,
        params: [{ name: "code", type: "string", required: true }],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no game has that code" }],
      },
    ],
  },
];

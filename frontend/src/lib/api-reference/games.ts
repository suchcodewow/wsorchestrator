/** Training → Games: each game's setup. */

import { GUESS_WHO_LIMITS } from "@/lib/games/guess-who";
import type { EndpointGroup } from "./types";

const TOOL_SHAPE = "{ id, name }";

export const GAMES_GROUPS: EndpointGroup[] = [
  {
    id: "training-games",
    title: "Games",
    intro:
      "The setup of each live review game a facilitator runs in front of the room. Games are for Training Administrators only. Play itself happens in the browser and is not stored; only the setup is.",
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
            { name: "tools", type: `${TOOL_SHAPE}[]`, required: true, note: `${GUESS_WHO_LIMITS.toolsMin} to ${GUESS_WHO_LIMITS.toolsMax}; name up to ${GUESS_WHO_LIMITS.nameMax} characters` },
            { name: "rounds", type: "{ red: string, blue: string }[]", required: true, note: `1 to ${GUESS_WHO_LIMITS.roundsMax}; each a tool id from tools` },
            { name: "questionCap", type: "integer", required: true, note: `${GUESS_WHO_LIMITS.capMin} to ${GUESS_WHO_LIMITS.capMax}` },
          ],
        },
        returns: "{ ok: true }",
        errors: [{ status: 400, error: "invalid", when: "the body does not parse, a tool id repeats, or a round names a tool not in tools; issues lists each problem's path" }],
      },
      {
        method: "DELETE",
        path: "/api/games/guess-who",
        summary: "Removes the saved setup, so Guess Who plays the defaults again.",
        access: "trainingAdmin",
        token: true,
        returns: "{ ok: true }",
      },
    ],
  },
];

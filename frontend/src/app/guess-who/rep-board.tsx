"use client";

/**
 * A rep's own view of a shared Guess Who game: pick Red or Blue, then knock
 * down and stand up that team's cards. Anyone on the team flips the same
 * board, and the facilitator's screen shows it to the room; the facilitator
 * still ends turns, takes guesses and keeps score.
 *
 * The page is one fixed link that follows whichever game is being shared, so
 * a link pinned in Slack works for every session. With none shared it waits,
 * and picks the next one up by itself. The team picked is kept in this
 * browser for that game, so a reload stays on it and a new game asks again.
 */

import { useMemo } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FLUID, NAME, StatusChip, ToolCard } from "@/app/(app)/games/guess-who/guess-who-game";
import { CURRENT, useSharedGame, useStored, type SharedGame } from "@/app/(app)/games/guess-who/use-shared-game";
import { boardOrder, TEAMS, type Team } from "@/lib/games/guess-who";
import { canFlip, makeReducer } from "@/lib/games/guess-who-play";
import { cn } from "@/lib/utils";

const teamKey = (code: string) => `guess-who:team:${code}`;

export function RepBoard({ initial }: { initial: SharedGame | null }) {
  const { game, send } = useSharedGame(CURRENT, initial);
  const [saved, pick] = useStored(teamKey(game?.code ?? "none"));
  const team: Team | null = saved === "red" || saved === "blue" ? saved : null;

  if (!game) {
    return (
      <Notice title="No game right now">This page picks the game up as soon as the facilitator starts one. Keep it open.</Notice>
    );
  }
  if (!team) return <TeamPicker onPick={pick} />;
  return <TeamView game={game} team={team} send={send} onSwitch={() => pick(null)} />;
}

function TeamPicker({ onPick }: { onPick: (team: Team) => void }) {
  return (
    <div className="space-y-6 py-10 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Guess Who</h1>
      <p className="text-lg text-muted-foreground">Which team are you on?</p>
      <div className="mx-auto grid max-w-xl grid-cols-2 gap-4">
        {TEAMS.map((team) => (
          <button
            key={team}
            type="button"
            onClick={() => onPick(team)}
            className={cn(
              "rounded-2xl px-6 py-10 text-3xl font-semibold text-white shadow-sm transition hover:shadow-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              team === "red" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {NAME[team]}
          </button>
        ))}
      </div>
    </div>
  );
}

function TeamView({
  game,
  team,
  send,
  onSwitch,
}: {
  game: SharedGame;
  team: Team;
  send: ReturnType<typeof useSharedGame>["send"];
  onSwitch: () => void;
}) {
  const { config, state } = game;
  const reduce = useMemo(() => makeReducer(config), [config]);
  const tools = useMemo(() => boardOrder(config.tools, `${state.version}:${state.round}`), [config.tools, state.version, state.round]);
  const side = state.sides[team];
  const flippable = canFlip(state, team);
  const red = team === "red";
  const pending = state.pending?.team === team ? state.pending : undefined;

  function flip(tool: string, down: boolean) {
    send("/flips", { team, tool, down }, (g) => ({ ...g, state: reduce(g.state, { type: "flip", team, id: tool, down }) }));
  }

  if (state.phase === "final") {
    return <Notice title="Game over">The final results are on the main screen.</Notice>;
  }

  return (
    <section aria-label={`${NAME[team]} team`} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-white", red ? "bg-red-600" : "bg-blue-600")}>
        <h1 className={cn(FLUID.title, "font-semibold tracking-tight")}>{NAME[team]} team</h1>
        <StatusChip side={side} />
        <span className={cn(FLUID.label, "opacity-90")}>
          Round {state.round + 1} of {config.rounds.length}
          {state.phase === "playing" && (state.turn === team ? " · your turn" : ` · ${NAME[state.turn]}'s turn`)}
        </span>
        <Button variant="ghost" size="sm" onClick={onSwitch} className="ml-auto text-white hover:bg-white/20 hover:text-white">
          <ArrowLeftRight />
          Switch team
        </Button>
      </header>

      <div className={cn(FLUID.small, "px-4 pt-3 pb-1 text-muted-foreground")}>
        {state.phase === "recap"
          ? "Round over: the answers are on the main screen."
          : pending
            ? "Your guess is on the main screen…"
            : `${config.tools.length - side.down.length} standing · ${side.down.length} down · tap a card to knock it down or stand it up`}
      </div>
      <div className="grid grid-cols-3 gap-2.5 px-4 pb-4 sm:grid-cols-4 md:grid-cols-6">
        {tools.map((tool, i) => {
          const down = side.down.includes(tool.id);
          return (
            <ToolCard
              key={tool.id}
              tool={tool}
              index={i}
              team={team}
              down={down}
              winner={false}
              verdict={pending?.id === tool.id ? (pending.correct ? "right" : "wrong") : undefined}
              clickable={flippable}
              guessing={false}
              onClick={() => flip(tool.id, !down)}
            />
          );
        })}
      </div>
    </section>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-2xl border bg-card px-6 py-12 text-center shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}

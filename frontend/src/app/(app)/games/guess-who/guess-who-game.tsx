"use client";

/**
 * Guess Who, played live on one screen. Red and Blue each have a board of the
 * same tool cards and their own mystery tool. The teams take turns: ask the
 * facilitator one yes-or-no question, knock down the cards it rules out, and
 * end the turn; or spend the turn on a guess. Score is the questions a team
 * used, guesses included, so the lower total wins. Nothing flags a card
 * knocked down by mistake; the team finds out when the board stops fitting
 * the answers, and stands it back up at no cost. A team that solves its board
 * waits while the other finishes, then the recap reveals both mysteries.
 *
 * Play is kept in this browser only, so a reload carries on where it was.
 */

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Maximize, Minimize, Minus, Plus, RotateCcw, Search, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import {
  boardOrder,
  TEAMS,
  type GuessWhoConfig,
  type GuessWhoTool,
  type Team,
} from "@/lib/games/guess-who";
import { SPRING_SNAPPY } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ToolLogo } from "./tool-logo";

type Log =
  | { kind: "question"; down: string[]; up: string[] }
  | { kind: "guess"; tool: string; correct: boolean };

type Side = {
  down: string[];
  questions: number;
  /** The facilitator's correction to this round's score, in questions. */
  adjust: number;
  status: "playing" | "solved" | "capped";
  log: Log[];
  /** Cards knocked down or stood up since the turn began. */
  turnDown: string[];
  turnUp: string[];
};

type State = {
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
   * grows, a banner says whether it is right) before it is applied by
   * `resolveGuess`. Everything waits while it is set.
   */
  pending?: { team: Team; id: string; correct: boolean };
};

type Action =
  | { type: "toggle"; id: string }
  | { type: "endTurn" }
  | { type: "guessMode"; on: boolean }
  | { type: "guess"; id: string }
  | { type: "resolveGuess" }
  | { type: "adjust"; team: Team; by: number }
  | { type: "nextRound" }
  | { type: "restart" }
  | { type: "load"; state: State };

const OTHER: Record<Team, Team> = { red: "blue", blue: "red" };
const NAME: Record<Team, string> = { red: "Red", blue: "Blue" };
const STORAGE_KEY = "guess-who:game";
/** How long a guess is shown before it is applied, in milliseconds. */
const VERDICT_MS = { wrong: 1600, right: 2800 } as const;

/**
 * Sizes that grow with the screen, so the room can read the game from the
 * back on a big monitor or projector; the minimums keep a laptop as it was.
 * Card text grows with the card instead (see ToolCard).
 */
const FLUID = {
  small: "text-[clamp(0.75rem,0.8vw,1.125rem)]",
  label: "text-[clamp(0.875rem,0.95vw,1.375rem)]",
  pill: "text-[clamp(0.875rem,1.15vw,1.625rem)]",
  title: "text-[clamp(1.25rem,1.6vw,2.5rem)]",
  number: "text-[clamp(1.5rem,2.2vw,3.25rem)]",
  total: "text-[clamp(1.125rem,1.5vw,2.25rem)]",
  icon: "size-[clamp(1rem,1.1vw,1.625rem)]",
  /** A control-bar button: taller, wider and larger-lettered on a big screen. */
  button: "h-[clamp(2.25rem,2.6vw,3.5rem)] px-[clamp(1rem,1.1vw,1.75rem)] text-[clamp(0.875rem,0.95vw,1.375rem)] [&_svg]:size-[clamp(1rem,1.1vw,1.625rem)]",
  iconButton: "size-[clamp(2.25rem,2.6vw,3.5rem)] [&_svg]:size-[clamp(1rem,1.1vw,1.625rem)]",
} as const;

const freshSide = (): Side => ({ down: [], questions: 0, adjust: 0, status: "playing", log: [], turnDown: [], turnUp: [] });
/** Red starts the first round, and the start alternates after. */
const firstTeam = (round: number): Team => (round % 2 === 0 ? "red" : "blue");
const roundScore = (s: Side) => Math.max(0, s.questions + s.adjust);

function fresh(version: string, round = 0, results: State["results"] = []): State {
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

function makeReducer(config: GuessWhoConfig) {
  /** After a turn: pass to the other team while it is still playing, and end the round once neither is. */
  function afterTurn(state: State, team: Team, side: Side): State {
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
  function resolve(state: State): State {
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
      down: p.correct ? config.tools.map((t) => t.id).filter((id) => id !== mystery) : [...side.down, p.id],
    };
    return afterTurn({ ...state, pending: undefined }, team, next);
  }

  return function reduce(state: State, action: Action): State {
    const team = state.turn;
    const side = state.sides[team];
    // While a guess is on show, only its own resolution, a restart or a load gets through.
    if (state.pending && !["resolveGuess", "restart", "load"].includes(action.type)) return state;
    switch (action.type) {
      case "toggle": {
        if (state.phase !== "playing" || side.status !== "playing" || state.guessing) return state;
        const id = action.id;
        const without = (list: string[]) => list.filter((d) => d !== id);
        let { turnDown, turnUp } = side;
        // A card knocked down and stood back up in the same turn (or the reverse) leaves no trace.
        if (side.down.includes(id)) {
          if (turnDown.includes(id)) turnDown = without(turnDown);
          else turnUp = [...turnUp, id];
          return { ...state, sides: { ...state.sides, [team]: { ...side, down: without(side.down), turnDown, turnUp } } };
        }
        if (turnUp.includes(id)) turnUp = without(turnUp);
        else turnDown = [...turnDown, id];
        return { ...state, sides: { ...state.sides, [team]: { ...side, down: [...side.down, id], turnDown, turnUp } } };
      }
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
        if (side.down.includes(action.id)) return state;
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
        return fresh(state.version, state.round + 1, results);
      }
      case "restart":
        return fresh(state.version);
      case "load":
        // A guess left on show when the page closed is simply applied.
        return resolve(action.state);
    }
  };
}

function load(version: string, config: GuessWhoConfig): State {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as State;
      if (saved.version === version && saved.round < config.rounds.length) return saved;
    }
  } catch {
    // Storage blocked or the saved game unreadable: start fresh.
  }
  return fresh(version);
}

export function GuessWhoGame({ config, version }: { config: GuessWhoConfig; version: string }) {
  const reducer = useMemo(() => makeReducer(config), [config]);
  const [state, dispatch] = useReducer(reducer, version, fresh);
  const byId = useMemo(() => new Map(config.tools.map((t) => [t.id, t])), [config.tools]);

  // The saved game is read after the first render, so the server's HTML and the browser's agree.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    dispatch({ type: "load", state: load(version, config) });
  }, [config, version]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Not saved; the game carries on regardless.
    }
  }, [state]);

  // A guess on show is applied once the room has seen it land.
  useEffect(() => {
    if (!state.pending) return;
    const timer = window.setTimeout(
      () => dispatch({ type: "resolveGuess" }),
      state.pending.correct ? VERDICT_MS.right : VERDICT_MS.wrong,
    );
    return () => window.clearTimeout(timer);
  }, [state.pending]);

  const { full, toggle } = useFullScreen();

  // Both boards share one order, new each round; the reducer doesn't care about order.
  const shown = useMemo(
    () => ({ ...config, tools: boardOrder(config.tools, `${version}:${state.round}`) }),
    [config, version, state.round],
  );

  const board = <Board config={shown} state={state} dispatch={dispatch} byId={byId} full={full} onFullScreen={toggle} />;
  // The shell's <main> is a size container, which would hold a fixed cover inside it, so the cover goes on <body>.
  if (full) return createPortal(<div className="fixed inset-0 z-45 overflow-auto bg-background p-6">{board}</div>, document.body);
  return board;
}

/**
 * Full screen for the room: the browser goes full screen and the game covers
 * the sidebar and header. The whole page goes full screen, not the game alone,
 * so the app's dialogs (which open outside it) still show. Esc leaves both.
 */
function useFullScreen() {
  const [full, setFull] = useState(false);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!full) return;
    // Without browser full screen (refused, or not offered), Esc still leaves the cover.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  function toggle() {
    if (full) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      setFull(false);
      return;
    }
    setFull(true);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  return { full, toggle };
}

function Board({
  config,
  state,
  dispatch,
  byId,
  full,
  onFullScreen,
}: {
  config: GuessWhoConfig;
  state: State;
  dispatch: (a: Action) => void;
  byId: Map<string, GuessWhoTool>;
  full: boolean;
  onFullScreen: () => void;
}) {
  const fullScreenButton = (
    <Button variant="ghost" size="icon" aria-label={full ? "Leave full screen" : "Full screen"} title={full ? "Leave full screen (Esc)" : "Full screen"} onClick={onFullScreen} className={FLUID.iconButton}>
      {full ? <Minimize /> : <Maximize />}
    </Button>
  );
  const round = config.rounds[Math.min(state.round, config.rounds.length - 1)]!;
  const totals = (team: Team) =>
    state.results.reduce((sum, r) => sum + r[team], 0) + (state.phase === "final" ? 0 : roundScore(state.sides[team]));

  async function restart() {
    if (
      await confirmDialog({
        title: "Start the game over?",
        description: "Every round's score and every board is cleared, back to round 1.",
        confirmLabel: "Start over",
        destructive: true,
      })
    ) {
      dispatch({ type: "restart" });
    }
  }

  if (state.phase === "final") {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">{fullScreenButton}</div>
        <FinalScreen state={state} totals={totals} onRestart={() => dispatch({ type: "restart" })} />
      </div>
    );
  }

  const active = state.sides[state.turn];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card px-5 py-3 shadow-sm">
        <span className={cn(FLUID.label, "font-medium text-muted-foreground")}>
          Round {state.round + 1} of {config.rounds.length} · cap {config.questionCap} questions
        </span>
        {state.phase === "playing" && (
          <span
            className={cn(
              "rounded-full px-[0.9em] py-[0.3em] font-semibold text-white",
              FLUID.pill,
              state.turn === "red" ? "bg-red-600" : "bg-blue-600",
            )}
          >
            {NAME[state.turn]}&apos;s turn
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {state.phase === "playing" && (
            <>
              <Button
                variant={state.guessing ? "secondary" : "outline"}
                onClick={() => dispatch({ type: "guessMode", on: !state.guessing })}
                disabled={active.status !== "playing" || !!state.pending}
                className={FLUID.button}
              >
                {state.guessing ? <X /> : <Search />}
                {state.guessing ? "Cancel guess" : "Make a guess"}
              </Button>
              <Button variant="brand" onClick={() => dispatch({ type: "endTurn" })} disabled={state.guessing || !!state.pending} className={FLUID.button}>
                End turn
                <ArrowRight />
              </Button>
            </>
          )}
          {state.phase === "recap" && (
            <Button variant="brand" onClick={() => dispatch({ type: "nextRound" })} className={FLUID.button}>
              {state.round + 1 >= config.rounds.length ? "Final results" : `Round ${state.round + 2}`}
              <ArrowRight />
            </Button>
          )}
          <Button variant="ghost" size="icon" aria-label="Start over" onClick={() => void restart()} className={FLUID.iconButton}>
            <RotateCcw />
          </Button>
          {fullScreenButton}
        </div>
      </div>

      {state.guessing && (
        <p role="status" className={cn(FLUID.label, "text-center font-medium")}>
          {NAME[state.turn]}: click the card you think it is. A guess counts as a question.
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        {TEAMS.map((team) => (
          <TeamBoard
            key={team}
            team={team}
            config={config}
            side={state.sides[team]}
            mystery={byId.get(round[team])!}
            byId={byId}
            active={state.phase === "playing" && state.turn === team && !state.pending}
            guessing={state.guessing && state.turn === team}
            recap={state.phase === "recap"}
            verdict={state.pending?.team === team ? verdictOf(state, team, byId) : undefined}
            total={totals(team)}
            dispatch={dispatch}
          />
        ))}
      </div>
    </div>
  );
}

/** What the banner says about a guess on show, and the card it is about. */
type Verdict = { id: string; correct: boolean; headline: string; detail: string };

function verdictOf(state: State, team: Team, byId: Map<string, GuessWhoTool>): Verdict | undefined {
  const p = state.pending;
  if (!p) return undefined;
  const name = byId.get(p.id)?.name ?? p.id;
  const used = state.sides[team].questions + 1;
  if (p.correct) {
    return { id: p.id, correct: true, headline: `${NAME[team]} got it!`, detail: `${name}, in ${used} ${used === 1 ? "question" : "questions"}` };
  }
  // The other team goes next unless it has finished its board.
  const next = state.sides[OTHER[team]].status === "playing" ? `${NAME[OTHER[team]]}'s turn` : `${NAME[team]} goes again`;
  return { id: p.id, correct: false, headline: `Not ${name}!`, detail: next };
}

function TeamBoard({
  team,
  config,
  side,
  mystery,
  byId,
  active,
  guessing,
  recap,
  verdict,
  total,
  dispatch,
}: {
  team: Team;
  config: GuessWhoConfig;
  side: Side;
  mystery: GuessWhoTool;
  byId: Map<string, GuessWhoTool>;
  active: boolean;
  guessing: boolean;
  recap: boolean;
  verdict: Verdict | undefined;
  total: number;
  dispatch: (a: Action) => void;
}) {
  const red = team === "red";
  const standing = config.tools.length - side.down.length;

  return (
    <section
      aria-label={`${NAME[team]} team`}
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow",
        active && (red ? "ring-4 ring-red-500/60" : "ring-4 ring-blue-500/60"),
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-white",
          red ? "bg-red-600" : "bg-blue-600",
        )}
      >
        <h2 className={cn(FLUID.title, "font-semibold tracking-tight")}>{NAME[team]} team</h2>
        <StatusChip side={side} />
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1.5" aria-label={`${NAME[team]} questions this round`}>
            <button
              type="button"
              aria-label={`Take a question off ${NAME[team]}'s score`}
              onClick={() => dispatch({ type: "adjust", team, by: -1 })}
              className="rounded-full p-1 opacity-70 hover:bg-white/20 hover:opacity-100"
            >
              <Minus className={FLUID.icon} />
            </button>
            <span className={cn(FLUID.label, "min-w-[6.5em] text-center")}>
              <span className={cn(FLUID.number, "font-bold tabular-nums")}>{roundScore(side)}</span> this round
            </span>
            <button
              type="button"
              aria-label={`Add a question to ${NAME[team]}'s score`}
              onClick={() => dispatch({ type: "adjust", team, by: 1 })}
              className="rounded-full p-1 opacity-70 hover:bg-white/20 hover:opacity-100"
            >
              <Plus className={FLUID.icon} />
            </button>
          </div>
          <span className={FLUID.label}>
            Total <span className={cn(FLUID.total, "font-semibold tabular-nums")}>{total}</span>
          </span>
        </div>
      </header>

      <div className={cn(FLUID.small, "px-4 pt-3 pb-1 text-muted-foreground")}>
        {standing} standing · {side.down.length} down
      </div>
      <div
        className={cn(
          "grid grid-cols-4 gap-2.5 px-4 pb-4 sm:grid-cols-6",
          !active && !recap && side.status === "playing" && "opacity-60",
        )}
      >
        {config.tools.map((tool, i) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            index={i}
            team={team}
            down={side.down.includes(tool.id)}
            winner={side.status === "solved" && tool.id === mystery.id}
            verdict={verdict?.id === tool.id ? (verdict.correct ? "right" : "wrong") : undefined}
            clickable={active}
            guessing={guessing}
            onClick={() => dispatch(guessing ? { type: "guess", id: tool.id } : { type: "toggle", id: tool.id })}
          />
        ))}
      </div>

      <AnimatePresence>
        {verdict && (
          <motion.div
            key="verdict"
            role="status"
            initial={{ opacity: 0, scale: 0.6, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 380, damping: 20 }}
            className="pointer-events-none absolute inset-x-0 top-[38%] z-20 flex justify-center px-6"
          >
            <div
              className={cn(
                "rounded-2xl px-[clamp(1.5rem,2.5vw,3.5rem)] py-[clamp(0.75rem,1.2vw,1.75rem)] text-center text-white shadow-2xl ring-4 ring-white/80",
                verdict.correct ? "bg-emerald-600" : "bg-red-600",
              )}
            >
              <p className="flex items-center justify-center gap-[0.3em] text-[clamp(2rem,3.6vw,5.5rem)] leading-none font-bold tracking-tight">
                {verdict.correct ? <Trophy className="size-[0.9em]" /> : <X className="size-[0.9em]" strokeWidth={3} />}
                {verdict.headline}
              </p>
              <p className={cn(FLUID.title, "mt-[0.4em] font-medium opacity-90")}>{verdict.detail}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {recap && (
          <motion.div
            key="reveal"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={SPRING_SNAPPY}
            className="border-t bg-card"
          >
            <Reveal tool={mystery} side={side} byId={byId} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function StatusChip({ side }: { side: Side }) {
  if (side.status === "playing") return null;
  return (
    <span className={cn(FLUID.label, "flex items-center gap-1 rounded-full bg-white/20 px-[0.75em] py-[0.15em] font-medium")}>
      {side.status === "solved" ? <Check className={FLUID.icon} /> : <X className={FLUID.icon} />}
      {side.status === "solved" ? `Solved in ${side.questions}` : "Hit the cap"}
    </span>
  );
}

/**
 * One card, hinged along its bottom edge as on the real board: knocked down,
 * it folds back nearly flat into its slot, and stood up it springs upright.
 */
function ToolCard({
  tool,
  index,
  team,
  down,
  winner,
  verdict,
  clickable,
  guessing,
  onClick,
}: {
  tool: GuessWhoTool;
  index: number;
  team: Team;
  down: boolean;
  winner: boolean;
  /** The card just guessed: it shakes with a red ✗ when wrong, and grows when right. */
  verdict?: "wrong" | "right";
  clickable: boolean;
  guessing: boolean;
  onClick: () => void;
}) {
  const disabled = !clickable || (guessing && down);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={down}
      aria-label={`${tool.name}${down ? ", knocked down" : ""}`}
      className={cn(
        // A size container, so the card's text and logo scale with the card itself.
        "group @container relative aspect-[3/4] rounded-xl [perspective:700px] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        clickable ? "cursor-pointer" : "cursor-default",
        verdict && "z-10",
      )}
    >
      {/* The slot a card folds down into. */}
      <span
        className={cn(
          "absolute inset-0 flex items-start justify-center rounded-xl border border-dashed px-[6cqw] pt-[30%] text-center text-[max(0.75rem,12cqw)] leading-tight font-semibold text-muted-foreground",
          team === "red" ? "bg-red-500/5" : "bg-blue-500/5",
        )}
      >
        {tool.name}
      </span>
      <motion.span
        className={cn(
          "absolute inset-0 flex flex-col items-center justify-center gap-[7cqw] rounded-xl border bg-card p-[6cqw] shadow-sm [backface-visibility:hidden]",
          clickable && !down && "group-hover:border-brand-border group-hover:shadow-md",
          guessing && !down && "ring-2 ring-amber-400/70",
          (winner || verdict === "right") && "ring-4 ring-amber-400",
          verdict === "wrong" && "border-red-500 ring-4 ring-red-500",
        )}
        style={{ transformOrigin: "50% 100%" }}
        initial={false}
        animate={{
          rotateX: down ? 84 : 0,
          opacity: down ? 0.35 : 1,
          x: verdict === "wrong" ? [0, -14, 14, -11, 11, -7, 7, -3, 0] : 0,
          scale: verdict === "right" ? 1.15 : 1,
        }}
        transition={{
          default: { type: "spring", stiffness: 260, damping: 18, mass: 0.7, delay: winner ? 0 : down ? (index % 6) * 0.015 : 0 },
          x: { duration: 0.6, ease: "easeInOut" },
          scale: { type: "spring", stiffness: 300, damping: 14 },
        }}
      >
        <ToolLogo tool={tool} className="w-[66%] text-[22cqw]" />
        <span className="line-clamp-2 text-center text-[max(0.75rem,12cqw)] leading-tight font-semibold">{tool.name}</span>
        {(winner || verdict === "right") && <Trophy className="absolute top-[5cqw] right-[5cqw] size-[12cqw] text-amber-500" />}
        {verdict === "wrong" && (
          <motion.span
            className="absolute inset-0 flex items-center justify-center rounded-xl bg-red-600/15"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 16 }}
            aria-hidden
          >
            <X className="size-[70cqw] text-red-600 drop-shadow" strokeWidth={3.5} />
          </motion.span>
        )}
      </motion.span>
    </button>
  );
}

/** After the round: the team's mystery tool, and its turns. */
function Reveal({
  tool,
  side,
  byId,
}: {
  tool: GuessWhoTool;
  side: Side;
  byId: Map<string, GuessWhoTool>;
}) {
  const name = (id: string) => byId.get(id)?.name ?? id;
  return (
    <div className="grid gap-4 px-5 py-4 md:grid-cols-[auto_1fr]">
      <div className="flex items-center gap-3">
        <ToolLogo tool={tool} className="size-[clamp(3.5rem,4.5vw,6.5rem)] text-xl" />
        <div>
          <p className={cn(FLUID.small, "font-medium tracking-wider text-muted-foreground uppercase")}>The mystery tool</p>
          <p className={cn(FLUID.title, "font-semibold")}>{tool.name}</p>
        </div>
      </div>
      {side.log.length > 0 && (
        <ol className={cn(FLUID.label, "space-y-1 self-center")}>
          {side.log.map((entry, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-[1.5em] shrink-0 text-right text-muted-foreground tabular-nums">{i + 1}.</span>
              {entry.kind === "guess" ? (
                <span>
                  Guessed <strong>{name(entry.tool)}</strong> {entry.correct ? "✓" : "✗"}
                </span>
              ) : (
                <span>
                  {entry.down.length ? <>Knocked down {entry.down.map(name).join(", ")}</> : "Knocked nothing down"}
                  {entry.up.length > 0 && <>; stood up {entry.up.map(name).join(", ")}</>}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function FinalScreen({
  state,
  totals,
  onRestart,
}: {
  state: State;
  totals: (team: Team) => number;
  onRestart: () => void;
}) {
  const red = totals("red");
  const blue = totals("blue");
  const winner: Team | null = red === blue ? null : red < blue ? "red" : "blue";
  return (
    <div className="space-y-6 rounded-2xl border bg-card px-6 py-10 text-center shadow-sm">
      <Trophy className="mx-auto size-[clamp(3rem,5vw,7rem)] text-amber-500" />
      <h2 className="text-[clamp(2.25rem,4vw,5.5rem)] font-semibold tracking-tight">
        {winner ? `${NAME[winner]} team wins` : "It's a tie"}
      </h2>
      <p className={cn(FLUID.label, "text-muted-foreground")}>Fewest questions across {state.results.length} rounds</p>
      <div className="mx-auto grid w-full max-w-[clamp(36rem,50vw,64rem)] grid-cols-2 gap-[clamp(1rem,1.5vw,2rem)]">
        {TEAMS.map((team) => (
          <div
            key={team}
            className={cn("rounded-2xl px-5 py-4 text-white", team === "red" ? "bg-red-600" : "bg-blue-600")}
          >
            <p className={cn(FLUID.title, "font-medium")}>{NAME[team]}</p>
            <p className="text-[clamp(3rem,6vw,8rem)] leading-none font-bold tabular-nums">{totals(team)}</p>
            <p className={cn(FLUID.label, "mt-2 opacity-80")}>{state.results.map((r) => r[team]).join(" · ")}</p>
          </div>
        ))}
      </div>
      <Button variant="outline" onClick={onRestart} className={FLUID.button}>
        <RotateCcw />
        Play again
      </Button>
    </div>
  );
}

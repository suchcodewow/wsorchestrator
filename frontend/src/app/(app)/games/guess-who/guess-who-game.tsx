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
 * Play is kept in this browser, so a reload carries on where it was, until
 * the facilitator invites reps: then the game is shared (`use-shared-game.ts`)
 * and reps knock down their own team's cards from `/guess-who` while this
 * screen shows the room both boards. Sharing here ends a game shared from
 * another screen, which carries on there unshared.
 */

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Copy, Maximize, Minimize, Minus, Plus, RotateCcw, Search, Trophy, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { boardOrder, TEAMS, type GuessWhoConfig, type GuessWhoTool, type Team } from "@/lib/games/guess-who";
import {
  canFlip,
  freshGame,
  makeReducer,
  OTHER,
  roundScore,
  type GameAction as Action,
  type GameState as State,
  type Side,
} from "@/lib/games/guess-who-play";
import { SPRING_SNAPPY } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ToolLogo } from "./tool-logo";
import { sharedGamePath, useSharedGame, useStored, writeStored, type SharedGame } from "./use-shared-game";

export const NAME: Record<Team, string> = { red: "Red", blue: "Blue" };
const STORAGE_KEY = "guess-who:game";
/** The code of the game this browser shared, while it is shared. */
const SHARED_KEY = "guess-who:shared";
/** How long a guess is shown before it is applied, in milliseconds. */
const VERDICT_MS = { wrong: 1600, right: 2800 } as const;

/**
 * Sizes that grow with the screen, so the room can read the game from the
 * back on a big monitor or projector; the minimums keep a laptop as it was.
 * Card text grows with the card instead (see ToolCard).
 */
export const FLUID = {
  small: "text-[clamp(0.75rem,0.8vw,1.125rem)]",
  label: "text-[clamp(0.875rem,0.95vw,1.375rem)]",
  pill: "text-[clamp(0.875rem,1.15vw,1.625rem)]",
  title: "text-[clamp(1.25rem,1.6vw,2.5rem)]",
  number: "text-[clamp(1.5rem,2.2vw,3.25rem)]",
  total: "text-[clamp(1.125rem,1.5vw,2.25rem)]",
  icon: "size-[clamp(1rem,1.1vw,1.625rem)]",
  /** A control-bar button: taller, wider and larger-lettered on a big screen. */
  button:
    "h-[clamp(2.25rem,2.6vw,3.5rem)] px-[clamp(1rem,1.1vw,1.75rem)] text-[clamp(0.875rem,0.95vw,1.375rem)] [&_svg]:size-[clamp(1rem,1.1vw,1.625rem)]",
  iconButton: "size-[clamp(2.25rem,2.6vw,3.5rem)] [&_svg]:size-[clamp(1rem,1.1vw,1.625rem)]",
} as const;

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
  return freshGame(version);
}

/** The link reps open, on this site: the same for every game. */
function joinUrl(): string {
  return `${window.location.origin}/guess-who`;
}

export function GuessWhoGame({ config: settingsConfig, version }: { config: GuessWhoConfig; version: string }) {
  const localReducer = useMemo(() => makeReducer(settingsConfig), [settingsConfig]);
  const [local, dispatchLocal] = useReducer(localReducer, version, freshGame);

  const [code, setCode] = useStored(SHARED_KEY);
  const shared = useSharedGame(code);
  const live = code ? shared.game : null;
  const config = live?.config ?? settingsConfig;
  const state = live?.state ?? local;
  const reducer = useMemo(() => (live ? makeReducer(live.config) : localReducer), [live, localReducer]);

  const byId = useMemo(() => new Map(config.tools.map((t) => [t.id, t])), [config.tools]);

  // The saved game is read after the first render, so the server's HTML and the browser's agree.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    dispatchLocal({ type: "load", state: load(version, settingsConfig) });
  }, [settingsConfig, version]);

  // The game is kept here as well while it is shared, so ending it carries on from where the room was.
  useEffect(() => {
    if (!loaded.current) return;
    writeStored(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Ended (here, in another tab, or by the API): carry on in this browser where the shared game was.
  const { gone } = shared;
  useEffect(() => {
    if (!gone) return;
    if (live) dispatchLocal({ type: "load", state: live.state });
    setCode(null);
  }, [gone, live, setCode]);

  function dispatch(action: Action) {
    if (!live) return dispatchLocal(action);
    if (action.type === "load") return;
    shared.send("/moves", action, (g) => ({ ...g, state: reducer(g.state, action) }));
  }

  // A guess on show is applied once the room has seen it land.
  const pending = state.pending;
  const resolveRef = useRef(dispatch);
  useEffect(() => {
    resolveRef.current = dispatch;
  });
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => resolveRef.current({ type: "resolveGuess" }), pending.correct ? VERDICT_MS.right : VERDICT_MS.wrong);
    return () => window.clearTimeout(timer);
  }, [pending]);

  const [inviting, setInviting] = useState(false);
  async function invite() {
    if (code) return setInviting(true);
    const res = await fetch("/api/games/guess-who/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: local }),
    });
    if (!res.ok) return;
    const game = (await res.json()) as SharedGame;
    setCode(game.code);
    setInviting(true);
  }
  async function stopSharing() {
    if (!code) return;
    setInviting(false);
    await fetch(sharedGamePath(code), { method: "DELETE" }).catch(() => undefined);
    if (live) dispatchLocal({ type: "load", state: live.state });
    setCode(null);
  }

  const { full, toggle } = useFullScreen();

  // Both boards share one order, new each round; the reducer doesn't care about order.
  const shown = useMemo(
    () => ({ ...config, tools: boardOrder(config.tools, `${state.version}:${state.round}`) }),
    [config, state.version, state.round],
  );

  const board = (
    <>
      <Board
        config={shown}
        state={state}
        dispatch={dispatch}
        byId={byId}
        full={full}
        onFullScreen={toggle}
        code={code}
        onInvite={() => void invite()}
      />
      {code && <InviteDialog open={inviting} onOpenChange={setInviting} onStop={() => void stopSharing()} />}
    </>
  );
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
  code,
  onInvite,
}: {
  config: GuessWhoConfig;
  state: State;
  dispatch: (a: Action) => void;
  byId: Map<string, GuessWhoTool>;
  full: boolean;
  onFullScreen: () => void;
  /** The code reps join with, while the game is shared. */
  code: string | null;
  onInvite: () => void;
}) {
  const inviteButton = (
    <Button
      variant={code ? "secondary" : "outline"}
      onClick={onInvite}
      className={FLUID.button}
      title={code ? "The link to send reps, and stop sharing" : "Let reps flip their team's cards from their own laptops"}
    >
      <Users />
      {code ? "Shared with reps" : "Invite reps"}
    </Button>
  );
  const fullScreenButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={full ? "Leave full screen" : "Full screen"}
      title={full ? "Leave full screen (Esc)" : "Full screen"}
      onClick={onFullScreen}
      className={FLUID.iconButton}
    >
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
        <div className="flex justify-end gap-2">
          {code && inviteButton}
          {fullScreenButton}
        </div>
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
          {inviteButton}
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
              <Button
                variant="brand"
                onClick={() => dispatch({ type: "endTurn" })}
                disabled={state.guessing || !!state.pending}
                className={FLUID.button}
              >
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
            flippable={canFlip(state, team)}
            guessing={state.guessing && state.turn === team && !state.pending}
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
    return {
      id: p.id,
      correct: true,
      headline: `${NAME[team]} got it!`,
      detail: `${name}, in ${used} ${used === 1 ? "question" : "questions"}`,
    };
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
  flippable,
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
  /** Whose turn it is. */
  active: boolean;
  /** Its cards can be knocked down or stood up: any time in a round, not only on its turn, since reps flip their own. */
  flippable: boolean;
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
      <header className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-white", red ? "bg-red-600" : "bg-blue-600")}>
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
        className={cn("grid grid-cols-4 gap-2.5 px-4 pb-4 sm:grid-cols-6", !active && !recap && side.status === "playing" && "opacity-60")}
      >
        {config.tools.map((tool, i) => {
          const down = side.down.includes(tool.id);
          return (
            <ToolCard
              key={tool.id}
              tool={tool}
              index={i}
              team={team}
              down={down}
              winner={side.status === "solved" && tool.id === mystery.id}
              verdict={verdict?.id === tool.id ? (verdict.correct ? "right" : "wrong") : undefined}
              clickable={guessing || flippable}
              guessing={guessing}
              onClick={() => dispatch(guessing ? { type: "guess", id: tool.id } : { type: "flip", team, id: tool.id, down: !down })}
            />
          );
        })}
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

export function StatusChip({ side }: { side: Side }) {
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
export function ToolCard({
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

/** The link to send reps, and ending the shared game. */
function InviteDialog({ open, onOpenChange, onStop }: { open: boolean; onOpenChange: (open: boolean) => void; onStop: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = joinUrl();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused: the link is on screen to select.
    }
  }

  async function stop() {
    if (
      await confirmDialog({
        title: "Stop sharing this game?",
        description: "The reps' page shows no game until you share one again. The game carries on here from where it is.",
        confirmLabel: "Stop sharing",
        destructive: true,
      })
    ) {
      onStop();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite reps</DialogTitle>
          <DialogDescription>
            Reps open the link, pick Red or Blue, and knock down their team&apos;s cards from their own laptops. Their flips show here within a
            second. The link is the same for every game, so it can stay pinned in Slack.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 items-center gap-3 rounded-2xl border px-5 py-2.5">
          <span className="text-sm text-muted-foreground">Link</span>
          <span className="min-w-0 truncate font-mono text-sm select-all">{url}</span>
          <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void stop()}>
            Stop sharing
          </Button>
          <Button variant="brand" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** After the round: the team's mystery tool, and its turns. */
function Reveal({ tool, side, byId }: { tool: GuessWhoTool; side: Side; byId: Map<string, GuessWhoTool> }) {
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

function FinalScreen({ state, totals, onRestart }: { state: State; totals: (team: Team) => number; onRestart: () => void }) {
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
          <div key={team} className={cn("rounded-2xl px-5 py-4 text-white", team === "red" ? "bg-red-600" : "bg-blue-600")}>
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

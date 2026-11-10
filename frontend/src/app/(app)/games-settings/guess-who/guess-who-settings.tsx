"use client";

/**
 * Guess Who's setup: how many rounds and each round's mystery tool for Red
 * and for Blue, the question cap, and the names on the tool cards. Saved
 * whole; a game already on someone's screen keeps its setup until restarted.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import {
  GUESS_WHO_LIMITS,
  guessWhoConfigSchema,
  toolId,
  type GuessWhoConfig,
  type GuessWhoTool,
  type Team,
} from "@/lib/games/guess-who";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";
import { ToolLogo } from "../../games/guess-who/tool-logo";

const SELECT = cn(
  "h-9 w-full cursor-pointer rounded-md border bg-card px-2.5 text-sm text-foreground shadow-xs outline-none",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-card",
);

export function GuessWhoSettingsForm({
  config,
  updatedAt,
  updatedBy,
}: {
  config: GuessWhoConfig;
  updatedAt: string | null;
  updatedBy: string | null;
}) {
  const router = useRouter();
  const [tools, setTools] = useState<GuessWhoTool[]>(config.tools);
  const [rounds, setRounds] = useState(config.rounds);
  const [cap, setCap] = useState(String(config.questionCap));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const draft = { tools, rounds, questionCap: Number(cap) };
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const problems = useMemo(() => describeProblems(tools, rounds, cap), [tools, rounds, cap]);

  function setTool(i: number, patch: Partial<GuessWhoTool>) {
    setTools((list) => list.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  function addTool() {
    setTools((list) => [
      ...list,
      { id: toolId("New tool", list.map((t) => t.id)), name: "New tool" },
    ]);
  }

  function removeTool(i: number) {
    const id = tools[i]!.id;
    setTools((list) => list.filter((_, j) => j !== i));
    // A round that named it needs a new pick, which the problems list asks for.
    setRounds((list) => list.map((r) => ({ red: r.red === id ? "" : r.red, blue: r.blue === id ? "" : r.blue })));
  }

  function setRound(i: number, team: Team, id: string) {
    setRounds((list) => list.map((r, j) => (j === i ? { ...r, [team]: id } : r)));
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/games/guess-who", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        setMessage({ ok: false, text: `Could not save (${res.status}).` });
        return;
      }
      setMessage({ ok: true, text: "Saved. Restart a game already on screen to use it." });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (
      !(await confirmDialog({
        title: "Go back to the defaults?",
        description: "Your tool cards and rounds are replaced with the ones from the Who serves the SDLC deck.",
        confirmLabel: "Use the defaults",
        destructive: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/games/guess-who", { method: "DELETE" });
      if (!res.ok) {
        setMessage({ ok: false, text: `Could not reset (${res.status}).` });
        return;
      }
      // The form holds its own copy of the setup, so reload it from the defaults.
      window.location.reload();
    } catch {
      setMessage({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <motion.div variants={staggerParent(0.04)} initial="hidden" animate="show" className="space-y-8">
      <motion.p variants={riseChild} className="text-sm text-muted-foreground">
        {tools.length} cards, {rounds.length} {rounds.length === 1 ? "round" : "rounds"} ·{" "}
        {updatedAt ? (
          <>
            saved {formatWhen(updatedAt)}
            {updatedBy && <> by {updatedBy}</>}
          </>
        ) : (
          "the defaults, never saved"
        )}
      </motion.p>

      <motion.section variants={riseChild} className="space-y-3">
        <h2 className="text-xl font-medium tracking-tight">Rounds</h2>
        <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
          {rounds.map((r, i) => (
            <div key={i} className="grid items-center gap-3 px-5 py-2.5 sm:grid-cols-[6rem_1fr_1fr_auto]">
              <span className="text-sm font-medium">Round {i + 1}</span>
              {(["red", "blue"] as const).map((team) => (
                <label key={team} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "w-12 shrink-0 text-sm font-semibold",
                      team === "red" ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400",
                    )}
                  >
                    {team === "red" ? "Red" : "Blue"}
                  </span>
                  <select
                    aria-label={`Round ${i + 1} ${team} mystery tool`}
                    value={r[team]}
                    onChange={(e) => setRound(i, team, e.target.value)}
                    className={SELECT}
                  >
                    <option value="">Choose a tool…</option>
                    {sorted.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove round ${i + 1}`}
                disabled={rounds.length <= 1}
                onClick={() => setRounds((list) => list.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 px-5 py-2.5">
            <Button
              variant="outline"
              size="sm"
              disabled={rounds.length >= GUESS_WHO_LIMITS.roundsMax}
              onClick={() => setRounds((list) => [...list, { red: "", blue: "" }])}
            >
              <Plus />
              Add round
            </Button>
            <label className="ml-auto flex items-center gap-2 text-sm">
              Question cap per round
              <Input
                type="number"
                min={GUESS_WHO_LIMITS.capMin}
                max={GUESS_WHO_LIMITS.capMax}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                className="w-20"
              />
            </label>
          </div>
        </div>
      </motion.section>

      <motion.section variants={riseChild} className="space-y-3">
        <h2 className="text-xl font-medium tracking-tight">Tool cards</h2>
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <ul className="grid gap-x-4 gap-y-2.5 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map((t, i) => (
              <li key={t.id} className="flex items-center gap-2">
                <ToolLogo tool={t} className="size-9 shrink-0 text-xs" />
                <Input
                  aria-label={`Card ${i + 1} name`}
                  value={t.name}
                  maxLength={GUESS_WHO_LIMITS.nameMax}
                  onChange={(e) => setTool(i, { name: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${t.name}`}
                  disabled={tools.length <= GUESS_WHO_LIMITS.toolsMin}
                  onClick={() => removeTool(i)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <div className="border-t px-5 py-2.5">
            <Button variant="outline" size="sm" disabled={tools.length >= GUESS_WHO_LIMITS.toolsMax} onClick={addTool}>
              <Plus />
              Add tool
            </Button>
          </div>
        </div>
      </motion.section>

      {problems.length > 0 && (
        <motion.ul variants={riseChild} role="alert" className="list-disc space-y-1 pl-5 text-sm text-destructive">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </motion.ul>
      )}

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <Button variant="brand" disabled={busy || !dirty || problems.length > 0} onClick={() => void save()}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
        <Button variant="outline" disabled={busy || !updatedAt} onClick={() => void reset()}>
          <RotateCcw />
          Use the defaults
        </Button>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
            {message.text}
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}

/** What stops a save, in words, before it is sent. */
function describeProblems(tools: GuessWhoTool[], rounds: GuessWhoConfig["rounds"], cap: string): string[] {
  const problems: string[] = [];
  const names = new Map<string, number>();
  for (const t of tools) {
    const key = t.name.trim().toLowerCase();
    if (!key) problems.push("Every tool card needs a name.");
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  for (const [name, n] of names) if (name && n > 1) problems.push(`Two cards are named “${name}”.`);
  rounds.forEach((r, i) => {
    if (!r.red) problems.push(`Round ${i + 1} needs Red's mystery tool.`);
    if (!r.blue) problems.push(`Round ${i + 1} needs Blue's mystery tool.`);
  });
  const n = Number(cap);
  if (!Number.isInteger(n) || n < GUESS_WHO_LIMITS.capMin || n > GUESS_WHO_LIMITS.capMax) {
    problems.push(`The question cap must be a whole number from ${GUESS_WHO_LIMITS.capMin} to ${GUESS_WHO_LIMITS.capMax}.`);
  }
  if (problems.length === 0 && !guessWhoConfigSchema.safeParse({ tools, rounds, questionCap: n }).success) {
    problems.push("Something in the setup is not valid; check each card's name.");
  }
  return [...new Set(problems)];
}

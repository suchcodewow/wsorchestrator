"use client";

/**
 * Day in the Life: Enterprise Security Team. Someone new at a made-up company
 * is put on the platform team that reviews software builds for vulnerabilities
 * by eye: three "months", each a few pages of builds shown for 20 seconds
 * apiece, with a rule added every month. They click the builds that break the
 * rules, are told the real count at the end of the month and scored on how
 * close they came, and get a performance review after the third. Nothing leaves
 * the browser and nothing is kept: closing the window starts again.
 */

import { Button } from "@/components/ui/button";
import {
  BUILDS_PER_PAGE,
  MAX_SCORE,
  REVIEWS,
  ROUNDS,
  SECONDS_PER_PAGE,
  actualCount,
  isVulnerable,
  marksFor,
  pointsFor,
  reviewFor,
  rulesInForce,
  whyVulnerable,
  type Build,
  type Marks,
  type Round,
  type Span,
  type RoundNumber,
} from "@/lib/mimir/security-game/scenario";
import { cn } from "@/lib/utils";
import { ArrowRight, ClipboardCheck, Eye, RotateCcw, ShieldAlert, Timer } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import "./security-team.css";
import { recordRun } from "./record-run";
import { WallClock } from "./wall-clock";

type Phase =
  | { at: "intro" }
  | { at: "rules"; round: number }
  | { at: "play"; round: number; page: number }
  | { at: "result"; round: number }
  | { at: "review" };

/** Which build is meant: its month, page and place on the page. */
const keyOf = (round: number, page: number, i: number) => `${round}:${page}:${i}`;

type Entry = { build: Build; why: string[] };

/** How a month went: what the player blocked against what was really there. */
function tally(round: Round, flagged: Set<string>) {
  const missed: Entry[] = [];
  const falseAlarms: Entry[] = [];
  let counted = 0;
  let caught = 0;
  round.pages.forEach((page, p) =>
    page.forEach((build, i) => {
      const vulnerable = isVulnerable(build, round.number);
      const blocked = flagged.has(keyOf(round.number, p, i));
      if (blocked) counted++;
      if (blocked && vulnerable) caught++;
      if (blocked && !vulnerable) falseAlarms.push({ build, why: [] });
      if (!blocked && vulnerable) missed.push({ build, why: whyVulnerable(build, round.number) });
    }),
  );
  return { counted, caught, missed, falseAlarms, actual: actualCount(round) };
}

export function SecurityTeamView() {
  const [phase, setPhase] = useState<Phase>({ at: "intro" });
  const [flagged, setFlagged] = useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setFlagged((f) => {
      const next = new Set(f);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const restart = () => {
    setFlagged(new Set());
    setPhase({ at: "intro" });
  };

  const scoreOf = (round: Round) => {
    const t = tally(round, flagged);
    return pointsFor(t.counted, t.actual);
  };

  if (phase.at === "intro") return <Intro onStart={() => setPhase({ at: "rules", round: 1 })} />;

  if (phase.at === "rules") {
    return <RulesScreen round={ROUNDS[phase.round - 1]} onStart={() => setPhase({ at: "play", round: phase.round, page: 0 })} />;
  }

  if (phase.at === "play") {
    const round = ROUNDS[phase.round - 1];
    return (
      // A new page is a new clock, so the page's place is the key.
      <PlayPage
        key={`${phase.round}:${phase.page}`}
        round={round}
        page={phase.page}
        flagged={flagged}
        onToggle={toggle}
        onTimeUp={() =>
          setPhase(
            phase.page + 1 < round.pages.length
              ? { at: "play", round: phase.round, page: phase.page + 1 }
              : { at: "result", round: phase.round },
          )
        }
      />
    );
  }

  if (phase.at === "result") {
    const round = ROUNDS[phase.round - 1];
    const earlier = ROUNDS.slice(0, phase.round - 1).reduce((sum, r) => sum + scoreOf(r), 0);
    return (
      <Result
        key={phase.round}
        round={round}
        result={tally(round, flagged)}
        earlier={earlier}
        onNext={() => {
          if (phase.round < ROUNDS.length) return setPhase({ at: "rules", round: phase.round + 1 });
          recordRun({ experience: "security", score: ROUNDS.reduce((sum, r) => sum + scoreOf(r), 0) });
          setPhase({ at: "review" });
        }}
      />
    );
  }

  const months = ROUNDS.map((r) => ({ round: r, ...tally(r, flagged) }));
  return <Review months={months} total={months.reduce((s, m) => s + pointsFor(m.counted, m.actual), 0)} onRestart={restart} />;
}

// ---------------------------------------------------------------- introduction

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Timer className="size-4" />
        8–10 minutes
      </p>
      <section className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex gap-3 bg-brand-subtle/50 px-5 py-4 text-sm">
          <span className="text-base leading-5" aria-hidden>
            👋
          </span>
          <p className="max-w-3xl">
            <span className="font-medium">Welcome to Globalcorp!</span> You’ve just been hired onto the Platform Team, which is responsible
            for security across the whole company. There’s no time for a tour: builds are already coming down the pipeline, so get started
            right away.
          </p>
        </div>
        <div className="flex gap-3 px-5 py-4 text-sm">
          <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-brand" />
          <p className="max-w-3xl">
            You’ll have <span className="font-medium">three months</span>, and at the end of them you’ll sit down for a{" "}
            <span className="font-medium">performance review</span> to see whether you make the cut.
          </p>
        </div>
        <div className="space-y-2 px-5 py-4 text-sm">
          <p className="font-medium">How the job works</p>
          <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
            <li>Each month is a few pages of software builds passing through the pipeline, eight to a page.</li>
            <li>Every month you’re given rules for what makes a build vulnerable. Click each build that breaks them to block it.</li>
            <li>You get {SECONDS_PER_PAGE} seconds a page. When the clock runs out, the next page arrives, and you can’t go back.</li>
            <li>
              At the end of the month you’ll learn how many vulnerable builds there really were, and score points for how close you came.
            </li>
          </ul>
        </div>
      </section>
      <Button variant="brand" onClick={onStart}>
        Start my first day
        <ArrowRight />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- the rules

function RuleList({ round }: { round: RoundNumber }) {
  const rules = rulesInForce(round);
  return (
    <ol className="divide-y">
      {rules.map((rule, i) => {
        const isNew = i === rules.length - 1;
        return (
          <li key={i} className={cn("flex gap-3 px-5 py-2.5 text-sm", !isNew && "text-muted-foreground")}>
            <span
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold",
                isNew ? "bg-brand text-brand-foreground" : "bg-muted",
              )}
            >
              {i + 1}
            </span>
            <span className="space-y-0.5">
              <span className={cn("block", isNew && "font-medium")}>
                {rule.text}
                {isNew && round > 1 && <span className="ml-2 rounded bg-brand-subtle px-1.5 py-0.5 text-xs text-brand">New</span>}
              </span>
              <span className="block text-xs text-muted-foreground">{rule.tip}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RulesScreen({ round, onStart }: { round: Round; onStart: () => void }) {
  // The sample builds are a practice round: the answer stays hidden until asked for.
  const [revealed, setRevealed] = useState(false);
  const vulnerable = round.examples.filter((build) => isVulnerable(build, round.number)).length;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          Month {round.number} of {ROUNDS.length}
        </p>
        <h2 className="text-xl font-semibold">Month {round.number} vulnerability rules</h2>
      </div>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {round.keepsEarlierRules && (
          <p className="border-b bg-muted/40 px-5 py-2.5 text-sm font-medium">All the earlier rules still apply, plus one more.</p>
        )}
        <RuleList round={round.number} />
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Check the packages: which of these {round.examples.length} builds are vulnerable?</h3>
          {!revealed && (
            <Button variant="brand" onClick={() => setRevealed(true)}>
              <Eye />
              See the answer
            </Button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {round.examples.map((build) => {
            const why = whyVulnerable(build, round.number);
            return (
              <div key={build.id} className="space-y-1.5">
                <BuildCard build={build} marks={revealed ? marksFor(build, round.number) : undefined} />
                {revealed && (
                  <p className={cn("text-xs", why.length ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {why.length ? `Vulnerable: ${why.join("; ")}` : "Fine: it breaks none of the rules"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {revealed && (
        <div className="space-y-1">
          <p className="text-2xl font-semibold">The total here is {vulnerable}!</p>
          {round.number === 1 && (
            <p className="text-sm text-muted-foreground">
              Remember, it counts as one blocked build as soon as the first vulnerability is found. The middle option has 2 vulnerabilities
              but still counts just once.
            </p>
          )}
        </div>
      )}

      {revealed && (
        <Button variant="brand" onClick={onStart} className="h-auto py-2 text-left whitespace-normal">
          <span>
            The timer starts when you click here! You’ll see {round.pages.length} pages, {SECONDS_PER_PAGE} seconds per page.{" "}
            {BUILDS_PER_PAGE} builds per page.
          </span>
          <ArrowRight />
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- a build

const CARD_COLOR: Record<Build["color"], string> = {
  plain: "bg-slate-600",
  blue: "bg-[#0b5394]",
  red: "bg-[#990000]",
  green: "bg-[#38761d]",
};

/** The ring drawn around whatever breaks a rule. */
const MARK = "rounded-full bg-yellow-300/25 ring-2 ring-yellow-300";

/** `text` with each span circled. */
function Circled({ text, spans }: { text: string; spans: Span[] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const { start, end } of spans) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <span key={start} className={cn(MARK, "mx-px px-0.5")}>
        {text.slice(start, end)}
      </span>,
    );
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function BuildCard({
  build,
  blocked,
  marks,
  onClick,
}: {
  build: Build;
  blocked?: boolean;
  /** What to circle, once the answer is shown. */
  marks?: Marks;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="block text-xs font-semibold tracking-wide uppercase">
        App ID: <Circled text={build.id} spans={marks?.digit ? [marks.digit] : []} />
      </span>
      {marks?.color && (
        <span className={cn(MARK, "absolute top-2.5 right-2.5 px-2 text-[10px] font-semibold tracking-widest uppercase")}>
          {build.color}
        </span>
      )}
      <span className="mt-2 block text-[10px] font-semibold tracking-widest uppercase opacity-70">Packages:</span>
      <span className="block font-mono text-sm leading-snug">
        {build.packages.map((p, i) => (
          <span key={i} className="block">
            <Circled text={p} spans={marks?.packages[i] ?? []} />
          </span>
        ))}
      </span>
      {blocked && (
        <span className="stamp-in absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[14deg] animate-[stamp-in_0.18s_ease-out_both] rounded border-[3px] border-red-700 bg-white px-2 py-0.5 text-sm font-black tracking-widest text-red-700 shadow-md">
          BLOCKED
        </span>
      )}
    </>
  );
  const classes = cn(
    "relative block w-full rounded-xl p-3 text-left text-white shadow-sm",
    CARD_COLOR[build.color],
    blocked && "ring-4 ring-red-500 ring-offset-2 ring-offset-background",
  );
  if (!onClick) return <div className={classes}>{body}</div>;
  return (
    <button
      type="button"
      aria-pressed={!!blocked}
      onClick={onClick}
      className={cn(
        classes,
        "cursor-pointer outline-none transition-transform hover:brightness-110 focus-visible:ring-4 focus-visible:ring-ring active:scale-[0.98]",
      )}
    >
      {body}
    </button>
  );
}

// ---------------------------------------------------------------- a page of builds

/** Seconds left from a fresh start, calling `onDone` once when they run out. */
function useCountdown(seconds: number, onDone: () => void) {
  const [left, setLeft] = useState(seconds);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const end = Date.now() + seconds * 1000;
    const id = setInterval(() => {
      const ms = end - Date.now();
      if (ms <= 0) {
        clearInterval(id);
        setLeft(0);
        done.current();
      } else {
        setLeft(ms / 1000);
      }
    }, 100);
    return () => clearInterval(id);
  }, [seconds]);
  return left;
}

function PlayPage({
  round,
  page,
  flagged,
  onToggle,
  onTimeUp,
}: {
  round: Round;
  page: number;
  flagged: Set<string>;
  onToggle: (key: string) => void;
  onTimeUp: () => void;
}) {
  const left = useCountdown(SECONDS_PER_PAGE, onTimeUp);
  const blockedThisMonth = [...flagged].filter((k) => k.startsWith(`${round.number}:`)).length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ShieldAlert className="size-4 text-brand" />
            Month {round.number} of {ROUNDS.length} · page {page + 1} of {round.pages.length}
          </p>
          <p className="text-sm text-muted-foreground">
            {blockedThisMonth} {blockedThisMonth === 1 ? "build" : "builds"} blocked this month
          </p>
        </div>
        <WallClock secondsLeft={left} total={SECONDS_PER_PAGE} />
      </div>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <RuleList round={round.number} />
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {round.pages[page].map((build, i) => {
          const key = keyOf(round.number, page, i);
          return <BuildCard key={key} build={build} blocked={flagged.has(key)} onClick={() => onToggle(key)} />;
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the month's result

function BuildList({ title, entries, empty }: { title: string; entries: Entry[]; empty: string }) {
  return (
    <div className="px-5 py-3 text-sm">
      <p className="font-medium">
        {title} ({entries.length})
      </p>
      {entries.length === 0 ? (
        <p className="mt-1 text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1.5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {entries.map(({ build, why }) => (
            <li key={`${build.id}:${build.packages.join(" ")}`} className="flex gap-2">
              <span className="font-mono text-xs leading-5 text-muted-foreground uppercase">{build.id}</span>
              <span className="text-muted-foreground">{why.length ? why.join("; ") : build.packages.join(" ")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Result({
  round,
  result,
  earlier,
  onNext,
}: {
  round: Round;
  result: ReturnType<typeof tally>;
  earlier: number;
  onNext: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const points = pointsFor(result.counted, result.actual);
  const off = Math.abs(result.counted - result.actual);
  const last = round.number === ROUNDS.length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          Month {round.number} of {ROUNDS.length}
        </p>
        <h2 className="text-xl font-semibold">{last ? "That’s a wrap on month three!" : `You made it through month ${round.number}!`}</h2>
      </div>

      <section className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="space-y-3 px-5 py-5 text-center">
          <p className="text-sm text-muted-foreground">How many vulnerable builds did you stop?</p>
          <p className="text-4xl font-semibold tabular-nums">{result.counted}</p>
          {!revealed ? (
            <Button variant="brand" onClick={() => setRevealed(true)}>
              There were actually…
            </Button>
          ) : (
            <div className="space-y-1 pt-1">
              <p className="text-sm text-muted-foreground">There were actually…</p>
              <p className="text-6xl font-bold text-destructive tabular-nums">{result.actual}!</p>
              <p className="pt-2 text-sm">
                {off === 0 ? "Exactly right." : `You were off by ${off}.`}{" "}
                <span className={cn("font-semibold", points > 0 ? "text-callout-success" : "text-muted-foreground")}>
                  +{points} {points === 1 ? "point" : "points"}
                </span>
              </p>
            </div>
          )}
        </div>

        {revealed && (
          <>
            <div className="flex flex-wrap gap-x-8 gap-y-1 px-5 py-2.5 text-sm">
              <span>
                Caught <span className="font-medium">{result.caught}</span> of {result.actual}
              </span>
              <span>
                Missed <span className="font-medium">{result.missed.length}</span>
              </span>
              <span>
                False alarms <span className="font-medium">{result.falseAlarms.length}</span>
              </span>
              <span className="ml-auto text-muted-foreground">
                Score so far: {earlier + points} of {MAX_SCORE}
              </span>
            </div>
            <details className="group">
              <summary className="cursor-pointer px-5 py-2.5 text-sm font-medium outline-none hover:bg-muted/30 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                What did I get wrong?
              </summary>
              <div className="divide-y border-t">
                <BuildList title="Vulnerable builds you missed" entries={result.missed} empty="You missed none." />
                <BuildList title="Builds you blocked that were fine" entries={result.falseAlarms} empty="You blocked nothing by mistake." />
              </div>
            </details>
            <p className="px-5 py-2.5 text-sm text-muted-foreground">
              Every build you missed is a vulnerability that shipped to production.
            </p>
          </>
        )}
      </section>

      {revealed && (
        <Button variant="brand" onClick={onNext}>
          {last ? "Go to my performance review" : `Start month ${round.number + 1}`}
          <ArrowRight />
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the performance review

function Review({
  months,
  total,
  onRestart,
}: {
  months: (ReturnType<typeof tally> & { round: Round })[];
  total: number;
  onRestart: () => void;
}) {
  const review = reviewFor(total);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">Three months later…</p>
        <h2 className="text-xl font-semibold">Your performance review</h2>
      </div>

      <section className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="space-y-2 bg-brand-subtle/50 px-5 py-6 text-center">
          <p className="text-sm text-muted-foreground">Your score</p>
          <p className="text-5xl font-bold tabular-nums">
            {total}
            <span className="text-2xl font-medium text-muted-foreground"> / {MAX_SCORE}</span>
          </p>
          <p className="pt-2 text-lg font-semibold">
            {review.pizza && <span aria-hidden>🍕 </span>}
            {review.title}
          </p>
          <p className="mx-auto max-w-xl text-sm text-muted-foreground">{review.verdict}</p>
        </div>
        {months.map(({ round, counted, actual }) => (
          <div key={round.number} className="flex flex-wrap items-baseline gap-x-6 gap-y-0.5 px-5 py-2.5 text-sm">
            <span className="w-20 font-medium">Month {round.number}</span>
            <span className="text-muted-foreground">
              You blocked {counted}, there were {actual}
            </span>
            <span className="ml-auto font-medium tabular-nums">+{pointsFor(counted, actual)}</span>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <p className="border-b bg-muted/40 px-5 py-2.5 text-sm font-medium">End of quarter team review results</p>
        <ul className="divide-y">
          {REVIEWS.map((r) => (
            <li
              key={r.title}
              className={cn("flex gap-4 px-5 py-2.5 text-sm", r === review ? "bg-brand-subtle/50 font-medium" : "text-muted-foreground")}
            >
              <span className="w-14 shrink-0 font-mono tabular-nums">
                {r.from}–{r.to}
              </span>
              <span>{r.title}</span>
            </li>
          ))}
        </ul>
      </section>

      <Button variant="ghost" onClick={onRestart}>
        <RotateCcw />
        Start over
      </Button>
    </div>
  );
}

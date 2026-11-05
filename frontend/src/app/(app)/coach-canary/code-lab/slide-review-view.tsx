"use client";

/**
 * Review the "Our understanding" slide. Ten made-up versions of the slide a
 * team plays back to a customer, one at a time, each with 10 to 15 small things
 * wrong: spelling, grammar, fonts, sizes, alignment, icons and things left
 * behind. Clicking something wrong puts it right for a point; clicking
 * something that was already right costs one; moving on costs two for each
 * thing missed, and shows what they were. The slide is drawn at the deck's own
 * 1280 × 720 and scaled to fit, so a few pixels out of line look the way they
 * would in the deck. Nothing leaves the browser and nothing is kept.
 */

import { Button } from "@/components/ui/button";
import {
  ARROW,
  BULLET,
  CAPABILITIES_TITLE,
  KIND_LABEL,
  MAX_SCORE,
  POINTS,
  SLIDES,
  TITLE,
  VERDICTS,
  pointsFor,
  verdictFor,
  type Extra,
  type Flaw,
  type Look,
  type RowIndex,
  type Side,
  type Slide,
  type SlideFont,
  type SlideResult,
  type Target,
} from "@/lib/mimir/slide-review/slides";
import { cn } from "@/lib/utils";
import { ArrowRight, Check, MousePointerClick, RotateCcw, Timer, X } from "lucide-react";
import { Geist } from "next/font/google";
import Image from "next/image";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import "./slide-review.css";

/** The deck's body font. The app's own mono is already Geist Mono. */
const geist = Geist({ subsets: ["latin"], display: "swap" });

type Phase = { at: "intro" } | { at: "slide"; index: number; reviewing: boolean } | { at: "done" };

export function SlideReviewView() {
  const [phase, setPhase] = useState<Phase>({ at: "intro" });
  const [results, setResults] = useState<SlideResult[]>([]);

  const restart = () => {
    setResults([]);
    setPhase({ at: "intro" });
  };

  if (phase.at === "intro") return <Intro onStart={() => setPhase({ at: "slide", index: 0, reviewing: false })} />;
  if (phase.at === "done") return <FinalScore results={results} onRestart={restart} />;

  const earlier = results.slice(0, phase.index).reduce((sum, r) => sum + pointsFor(r), 0);
  return (
    // A new slide starts with nothing fixed, so the slide is the key.
    <SlideRound
      key={phase.index}
      index={phase.index}
      earlier={earlier}
      onFinish={(result) => {
        setResults((rs) => [...rs.slice(0, phase.index), result]);
        setPhase({ at: "slide", index: phase.index, reviewing: true });
      }}
      reviewing={phase.reviewing}
      onNext={() =>
        setPhase(phase.index + 1 < SLIDES.length ? { at: "slide", index: phase.index + 1, reviewing: false } : { at: "done" })
      }
    />
  );
}

// ---------------------------------------------------------------- introduction

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Timer className="size-4" />
        10–15 minutes
      </p>
      <section className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex gap-3 bg-brand-subtle/50 px-5 py-4 text-sm">
          <span className="text-base leading-5" aria-hidden>
            🔍
          </span>
          <p className="max-w-3xl">
            <span className="font-medium">The customer meeting is in an hour.</span> Your team has drafted ten “Our
            understanding” slides, and every one of them has small mistakes in it. Find them before the customer does.
          </p>
        </div>
        <div className="space-y-2 px-5 py-4 text-sm">
          <p className="font-medium">How it works</p>
          <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
            <li>You see one slide at a time. Each has between 10 and 15 things wrong with it.</li>
            <li>Click anything that’s wrong and it corrects itself.</li>
            <li>When you think you’ve found everything, click Next. You’ll see what you missed before the next slide.</li>
          </ul>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-1 px-5 py-2.5 text-sm">
          <span>
            <span className="font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">+{POINTS.found}</span> for each
            mistake you fix
          </span>
          <span>
            <span className="font-semibold text-destructive tabular-nums">{POINTS.wrongClick}</span> for clicking something that
            was fine
          </span>
          <span>
            <span className="font-semibold text-destructive tabular-nums">{POINTS.missed}</span> for each mistake you miss
          </span>
        </div>
        <div className="space-y-2 px-5 py-4 text-sm">
          <p className="font-medium">What to look for</p>
          <p className="text-muted-foreground">
            Spelling and grammar, punctuation, capitalization, a font or size that doesn’t match the rest, bold or italic out of
            place, colors, anything out of line or unevenly spaced, the wrong icon, text that runs over its column, and anything
            left behind from an edit.
          </p>
        </div>
      </section>
      <Button variant="brand" onClick={onStart}>
        Start reviewing
        <ArrowRight />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- one slide

type Float = { id: number; x: number; y: number; good: boolean };

function SlideRound({
  index,
  earlier,
  reviewing,
  onFinish,
  onNext,
}: {
  index: number;
  earlier: number;
  reviewing: boolean;
  onFinish: (result: SlideResult) => void;
  onNext: () => void;
}) {
  const slide = SLIDES[index];
  const [fixed, setFixed] = useState<Set<Target>>(new Set());
  const [wrongClicks, setWrongClicks] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const nextFloat = useRef(0);

  const flawOf = (t: Target) => slide.flaws.find((fl) => fl.target === t);
  const missed = slide.flaws.filter((fl) => !fixed.has(fl.target));
  const score = earlier + (reviewing ? pointsFor({ found: fixed.size, wrongClicks, missed: missed.length }) : fixed.size * POINTS.found + wrongClicks * POINTS.wrongClick);

  const click = (target: Target, at: { x: number; y: number }) => {
    if (reviewing || fixed.has(target)) return;
    const good = !!flawOf(target);
    if (good) setFixed((s) => new Set(s).add(target));
    else setWrongClicks((n) => n + 1);
    const id = nextFloat.current++;
    setFloats((fs) => [...fs, { id, ...at, good }]);
    setTimeout(() => setFloats((fs) => fs.filter((fl) => fl.id !== id)), 900);
  };

  const game: GameState = {
    look: (t) => (fixed.has(t) ? {} : (flawOf(t)?.look ?? {})),
    status: (t) => (fixed.has(t) ? "fixed" : reviewing && flawOf(t) ? "missed" : "plain"),
    badge: (t) => (reviewing && !fixed.has(t) && flawOf(t) ? missed.indexOf(flawOf(t)!) + 1 : undefined),
    click,
    reviewing,
  };

  const found = slide.flaws.filter((fl) => fixed.has(fl.target));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="text-sm text-muted-foreground">
          Slide {index + 1} of {SLIDES.length}
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">Fixed on this slide:</span>{" "}
          <span className="font-medium tabular-nums">{fixed.size}</span>
          {reviewing && <span className="text-muted-foreground tabular-nums"> of {slide.flaws.length}</span>}
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">Wrong clicks:</span>{" "}
          <span className="font-medium tabular-nums">{wrongClicks}</span>
        </p>
        <p className="ml-auto flex items-baseline gap-2 rounded-xl border bg-card px-4 py-1.5 shadow-sm">
          <span className="text-sm text-muted-foreground">Score</span>
          <span className={cn("text-2xl font-bold tabular-nums", score < 0 && "text-destructive")}>{score}</span>
        </p>
        {reviewing ? (
          <Button variant="brand" onClick={onNext}>
            {index + 1 < SLIDES.length ? "Next slide" : "See my score"}
            <ArrowRight />
          </Button>
        ) : (
          <Button variant="brand" onClick={() => onFinish({ found: fixed.size, wrongClicks, missed: missed.length })}>
            Next
            <ArrowRight />
          </Button>
        )}
      </div>

      <Game.Provider value={game}>
        <SlideCanvas slide={slide} floats={floats} />
      </Game.Provider>

      {reviewing ? (
        <ReviewList slide={slide} missed={missed} found={found} />
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <p className="flex items-center gap-2 border-b bg-muted/40 px-5 py-2.5 text-sm font-medium">
            <MousePointerClick className="size-4 text-muted-foreground" />
            {found.length ? `Fixed so far: ${found.length}` : "Click anything on the slide that’s wrong"}
          </p>
          {found.length > 0 && (
            <ul className="divide-y">
              {found.map((fl) => (
                <FlawRow key={fl.target} flaw={fl} found />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function FlawRow({ flaw, found, n }: { flaw: Flaw; found: boolean; n?: number }) {
  return (
    <li className="flex items-baseline gap-3 px-5 py-2.5 text-sm">
      {n !== undefined ? (
        <span className="grid size-5 shrink-0 translate-y-0.5 place-items-center rounded-full bg-red-600 text-xs font-semibold text-white">
          {n}
        </span>
      ) : (
        <Check className={cn("size-4 shrink-0 translate-y-0.5", found ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} />
      )}
      <span className="w-32 shrink-0 font-medium">{KIND_LABEL[flaw.kind]}</span>
      <span className="text-muted-foreground">{flaw.note}</span>
    </li>
  );
}

function ReviewList({ slide, missed, found }: { slide: Slide; missed: Flaw[]; found: Flaw[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <p className="border-b bg-muted/40 px-5 py-2.5 text-sm font-medium">
        {missed.length
          ? `You found ${found.length} of ${slide.flaws.length}. The ${missed.length} you missed are marked on the slide (${missed.length * POINTS.missed} points).`
          : `You found all ${slide.flaws.length}. Nothing got past you.`}
      </p>
      <ul className="divide-y">
        {missed.map((fl, i) => (
          <FlawRow key={fl.target} flaw={fl} found={false} n={i + 1} />
        ))}
        {found.map((fl) => (
          <FlawRow key={fl.target} flaw={fl} found />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- the slide itself

type GameState = {
  look: (t: Target) => Look;
  status: (t: Target) => "plain" | "fixed" | "missed";
  badge: (t: Target) => number | undefined;
  click: (t: Target, at: { x: number; y: number }) => void;
  reviewing: boolean;
};

const Game = createContext<GameState | null>(null);
const useGame = () => useContext(Game)!;

/** The deck's slide, in its own pixels. */
const W = 1280;
const H = 720;

const INK = "#111110";
const MUTED_INK = "#3a3a36";
const RULE = "#e7e7e5";

const FONT: Record<SlideFont, string> = {
  geist: geist.style.fontFamily,
  "geist-mono": "var(--font-mono)",
  georgia: "Georgia, serif",
  arial: "Arial, Helvetica, sans-serif",
  times: "'Times New Roman', Times, serif",
  verdana: "Verdana, sans-serif",
  courier: "'Courier New', Courier, monospace",
};

type TextBase = { font: SlideFont; size: number; weight?: number; italic?: boolean; color?: string };

function textStyle(base: TextBase, look: Look): CSSProperties {
  return {
    fontFamily: FONT[look.font ?? base.font],
    fontSize: look.size ?? base.size,
    fontWeight: look.weight ?? base.weight ?? 400,
    fontStyle: (look.italic ?? base.italic) ? "italic" : "normal",
    color: look.color ?? base.color ?? INK,
    lineHeight: 1.25,
    textDecoration: look.underline ? "underline" : undefined,
    backgroundColor: look.highlight ? "#fde047" : undefined,
  };
}

/** Where everything sits on the deck's template. */
const L = {
  margin: 67,
  right: 1213,
  titleY: 50,
  subtitleY: 121,
  logo: { right: 1204, y: 66, w: 122, h: 27 },
  headerY: 180,
  headerRule: 209,
  columnTop: 168,
  divider: 615,
  columnBottom: 491,
  col: { current: 110, future: 742 } satisfies Record<Side, number>,
  rowY: (i: number) => 222 + i * 51.5,
  box: { x: 67, y: 491, w: 1146, h: 161 },
  capsTitleY: 504,
  capY: (i: number) => 531 + i * 23,
};

function useScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, scale };
}

function SlideCanvas({ slide, floats }: { slide: Slide; floats: Float[] }) {
  const { ref, scale } = useScale();
  const extra = slide.flaws.find((fl) => fl.extra);
  const extraFixed = useGame().status("extra") === "fixed";
  return (
    <div ref={ref} className="relative aspect-video w-full overflow-hidden rounded-lg border shadow-sm">
      <div
        className="absolute top-0 left-0 origin-top-left"
        // Ligatures off: Geist would draw a typed "->" as the very arrow it is meant to be told apart from.
        style={{
          width: W,
          height: H,
          transform: `scale(${scale})`,
          backgroundColor: "#f8f8f7",
          fontFamily: FONT.geist,
          fontFeatureSettings: '"calt" 0, "liga" 0',
          fontVariantLigatures: "none",
        }}
      >
        {/* The template's frame. */}
        <div className="absolute top-0 h-full w-px" style={{ left: L.margin - 1, backgroundColor: RULE }} />
        <div className="absolute top-0 h-full w-px" style={{ left: L.right + 1, backgroundColor: RULE }} />
        <div className="absolute left-0 h-px w-full" style={{ top: L.columnTop, backgroundColor: RULE }} />
        <div className="absolute left-0 h-px w-full" style={{ top: L.box.y + L.box.h, backgroundColor: RULE }} />
        <div className="absolute h-px" style={{ top: L.headerRule, left: L.margin, width: L.right - L.margin, backgroundColor: RULE }} />

        <TextPiece target="title" x={L.margin} y={L.titleY} base={{ font: "georgia", size: 40 }}>
          {TITLE}
        </TextPiece>
        <TextPiece target="subtitle" x={L.margin} y={L.subtitleY} base={{ font: "georgia", size: 17.3, color: MUTED_INK }}>
          {slide.subtitle}
        </TextPiece>
        <Logo />

        <Divider />
        <ArrowShape />

        {(["current", "future"] as const).map((side) => (
          <Column key={side} side={side} rows={slide[side]} />
        ))}

        <CapabilitiesBox />
        <TextPiece target="capabilitiesTitle" x={88} y={L.capsTitleY} base={{ font: "geist-mono", size: 14, color: MUTED_INK }}>
          {CAPABILITIES_TITLE}
        </TextPiece>
        {slide.capabilities.map((cap, i) => (
          <CapabilityLine key={i} i={i} lead={cap.lead} metric={cap.metric} />
        ))}

        {extra?.extra && !extraFixed && <ExtraPiece extra={extra.extra} />}

        {floats.map((fl) => (
          <span
            key={fl.id}
            aria-hidden
            className={cn(
              "slide-review-float pointer-events-none absolute rounded-full px-2.5 py-0.5 text-xl font-bold text-white shadow-md",
              fl.good ? "bg-emerald-600" : "bg-red-600",
            )}
            style={{ left: fl.x, top: fl.y }}
          >
            {fl.good ? `+${POINTS.found}` : POINTS.wrongClick}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One clickable piece, wherever it sits on the slide. */
function Piece({
  target,
  x,
  y,
  label,
  className,
  style,
  children,
}: {
  target: Target;
  x: number;
  y: number;
  label: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const game = useGame();
  const look = game.look(target);
  const status = game.status(target);
  const badge = game.badge(target);
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    // Where on the slide the click landed, in the slide's own pixels.
    const canvas = e.currentTarget.offsetParent as HTMLElement;
    const box = canvas.getBoundingClientRect();
    const k = box.width / W;
    game.click(target, { x: (e.clientX - box.left) / k, y: (e.clientY - box.top) / k });
  };
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={game.reviewing}
      className={cn(
        "absolute block rounded-[3px] text-left whitespace-nowrap outline-offset-2 disabled:cursor-default",
        !game.reviewing && status !== "fixed" && "cursor-pointer hover:outline-2 hover:outline-sky-500/40 hover:outline-dashed",
        status === "fixed" && "outline-2 outline-emerald-500/70 outline-solid",
        status === "missed" && "outline-2 outline-red-600 outline-solid",
        className,
      )}
      style={{ left: x + (look.dx ?? 0), top: y + (look.dy ?? 0), ...style }}
    >
      {children}
      {badge !== undefined && (
        <span
          className="absolute -top-3 -right-3 grid size-6 place-items-center rounded-full bg-red-600 text-sm font-semibold text-white shadow"
          style={{ fontFamily: FONT.geist, fontStyle: "normal" }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function TextPiece({ target, x, y, base, children }: { target: Target; x: number; y: number; base: TextBase; children: string }) {
  const look = useGame().look(target);
  const text = look.text ?? children;
  return (
    <Piece target={target} x={x} y={y} label={text} style={textStyle(base, look)}>
      {text}
    </Piece>
  );
}

function Logo() {
  const look = useGame().look("logo");
  const w = L.logo.w * (look.stretch ?? 1);
  return (
    <Piece target="logo" x={L.logo.right - w} y={L.logo.y} label="Harness logo">
      <Image src="/harness-wordmark.png" alt="" width={366} height={80} className="block" style={{ width: w, height: L.logo.h }} />
    </Piece>
  );
}

function Divider() {
  return (
    <Piece target="divider" x={L.divider - 4} y={L.columnTop} label="Column divider" style={{ width: 9, height: L.columnBottom - L.columnTop }}>
      <span className="absolute inset-y-0 left-1 w-px" style={{ backgroundColor: RULE }} />
    </Piece>
  );
}

function ArrowShape() {
  const look = useGame().look("arrow");
  const k = look.scale ?? 1;
  const w = 56 * k;
  const h = 66 * k;
  return (
    <Piece target="arrow" x={L.divider - w / 2} y={330 - h / 2} label="Arrow between the columns" style={{ width: w, height: h }}>
      <svg viewBox="0 0 56 66" width={w} height={h} className="block" style={{ transform: look.pointLeft ? "scaleX(-1)" : undefined }}>
        <path d="M1 1 L55 33 L1 65 Z" fill="#fff" stroke="#cfcfcf" strokeWidth={1.4} strokeLinejoin="round" />
      </svg>
    </Piece>
  );
}

function Mark({ kind, size }: { kind: "check" | "cross"; size: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} className="block" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {kind === "cross" ? (
        <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" stroke="#e5484d" />
      ) : (
        <path d="M1.8 6.4 L4.6 9.2 L10.4 2.8" stroke="#2f9e62" />
      )}
    </svg>
  );
}

function Column({ side, rows }: { side: Side; rows: Slide["current"] }) {
  const game = useGame();
  const x = L.col[side];
  const mark = side === "current" ? "cross" : "check";
  const headerLook = game.look(`headerIcon.${side}`);
  const headerMark = headerLook.icon ?? mark;
  const headerSize = 22 * (headerLook.scale ?? 1);
  return (
    <>
      <Piece
        target={`headerIcon.${side}`}
        x={x - 35 - (headerSize - 22) / 2}
        y={L.headerY - 3 - (headerSize - 22) / 2}
        label={`${side === "current" ? "Current" : "Future"} state icon`}
      >
        <span
          className="grid place-items-center rounded-full"
          style={{ width: headerSize, height: headerSize, backgroundColor: headerMark === "cross" ? "#fde8e8" : "#e3f5ea" }}
        >
          <Mark kind={headerMark} size={headerSize * 0.6} />
        </span>
      </Piece>
      <TextPiece target={`header.${side}`} x={x} y={L.headerY} base={{ font: "geist-mono", size: 16 }}>
        {side === "current" ? "Current state" : "Future state"}
      </TextPiece>
      {rows.map((row, i) => {
        const y = L.rowY(i);
        const iconLook = game.look(`${side}.${i as RowIndex}.icon`);
        const size = 13 * (iconLook.scale ?? 1);
        return (
          <span key={i}>
            <TextPiece target={`${side}.${i as RowIndex}.head`} x={x} y={y} base={{ font: "geist", size: 16, weight: 500 }}>
              {row.head}
            </TextPiece>
            <Piece
              target={`${side}.${i as RowIndex}.icon`}
              x={x + 1 - (size - 13) / 2}
              y={y + 24 - (size - 13) / 2}
              label={`${side === "current" ? "Cross" : "Tick"} beside “${row.sub}”`}
              className="p-0.5"
            >
              <Mark kind={iconLook.icon ?? mark} size={size} />
            </Piece>
            <TextPiece target={`${side}.${i as RowIndex}.sub`} x={x + 19} y={y + 21} base={{ font: "geist", size: 13.3, italic: true }}>
              {row.sub}
            </TextPiece>
          </span>
        );
      })}
    </>
  );
}

function CapabilitiesBox() {
  const look = useGame().look("capabilitiesBox");
  const { w, h } = L.box;
  const corner = (pos: CSSProperties, sides: string) => (
    <span className={cn("absolute size-3", sides)} style={{ ...pos, borderColor: "#b7b7b6" }} />
  );
  return (
    <Piece target="capabilitiesBox" x={L.box.x} y={L.box.y} label="Required capabilities box" style={{ width: w, height: h }}>
      <span
        className="absolute inset-0 bg-white"
        style={{ border: `1.5px ${look.solid ? "solid" : "dashed"} ${look.solid ? "#b7b7b6" : "#dcdcd9"}` }}
      />
      {corner({ left: -7, top: -7 }, "border-t border-l")}
      {corner({ right: -7, top: -7 }, "border-t border-r")}
      {corner({ left: -7, bottom: -7 }, "border-b border-l")}
      {corner({ right: -7, bottom: -7 }, "border-b border-r")}
    </Piece>
  );
}

function CapabilityLine({ i, lead, metric }: { i: number; lead: string; metric: string }) {
  const target: Target = `capability.${i}`;
  const look = useGame().look(target);
  const shownLead = look.text ?? lead;
  const shownMetric = look.metric ?? metric;
  const arrow = look.arrow ?? ARROW;
  const line = shownMetric ? `${shownLead} ${arrow} ${shownMetric}` : shownLead;
  return (
    <Piece target={target} x={92} y={L.capY(i)} label={line} style={textStyle({ font: "geist", size: 14.2, color: MUTED_INK }, look)}>
      <span className="inline-block w-8" style={{ fontSize: look.bullet ? 14 : 9, verticalAlign: look.bullet ? undefined : "2px" }}>
        {look.bullet ?? BULLET}
      </span>
      {line}
    </Piece>
  );
}

function ExtraPiece({ extra }: { extra: Extra }) {
  return (
    <Piece
      target="extra"
      x={extra.x}
      y={extra.y}
      label={extra.text}
      className={cn(extra.style === "sticky" ? "-rotate-2 px-3 py-2 shadow-md" : "px-3 py-2")}
      style={
        extra.style === "sticky"
          ? { backgroundColor: "#fef08a", color: "#44403c", fontSize: 14, fontFamily: FONT.geist }
          : { border: "1.5px dashed #a8a8a4", color: "#8a8a86", fontSize: 15, fontFamily: FONT.geist }
      }
    >
      {extra.text}
    </Piece>
  );
}

// ---------------------------------------------------------------- the final score

function FinalScore({ results, onRestart }: { results: SlideResult[]; onRestart: () => void }) {
  const total = results.reduce((sum, r) => sum + pointsFor(r), 0);
  const verdict = verdictFor(total);
  const totals = results.reduce(
    (t, r) => ({ found: t.found + r.found, wrongClicks: t.wrongClicks + r.wrongClicks, missed: t.missed + r.missed }),
    { found: 0, wrongClicks: 0, missed: 0 },
  );
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">All {SLIDES.length} slides reviewed</p>
        <h2 className="text-xl font-semibold">Your final score</h2>
      </div>

      <section className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="space-y-2 bg-brand-subtle/50 px-5 py-6 text-center">
          <p className={cn("text-5xl font-bold tabular-nums", total < 0 && "text-destructive")}>
            {total}
            <span className="text-2xl font-medium text-muted-foreground"> / {MAX_SCORE}</span>
          </p>
          <p className="pt-2 text-lg font-semibold">{verdict.title}</p>
          <p className="mx-auto max-w-xl text-sm text-muted-foreground">{verdict.verdict}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-x-8 gap-y-1 px-5 py-2.5 text-sm">
          <span className="flex items-center gap-1.5">
            <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
            {totals.found} fixed
          </span>
          <span className="flex items-center gap-1.5">
            <MousePointerClick className="size-4 text-muted-foreground" />
            {totals.wrongClicks} wrong click{totals.wrongClicks === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-1.5">
            <X className="size-4 text-destructive" />
            {totals.missed} missed
          </span>
        </div>
        {results.map((r, i) => (
          <div key={i} className="flex flex-wrap items-baseline gap-x-6 gap-y-0.5 px-5 py-2.5 text-sm">
            <span className="w-16 font-medium">Slide {i + 1}</span>
            <span className="text-muted-foreground">
              Fixed {r.found} of {r.found + r.missed}
              {r.wrongClicks > 0 && `, ${r.wrongClicks} wrong click${r.wrongClicks === 1 ? "" : "s"}`}
            </span>
            <span className={cn("ml-auto font-medium tabular-nums", pointsFor(r) < 0 && "text-destructive")}>
              {pointsFor(r) > 0 ? "+" : ""}
              {pointsFor(r)}
            </span>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <ul className="divide-y">
          {VERDICTS.map((v, i) => (
            <li
              key={v.title}
              className={cn("flex gap-4 px-5 py-2.5 text-sm", v === verdict ? "bg-brand-subtle/50 font-medium" : "text-muted-foreground")}
            >
              <span className="w-24 shrink-0 font-mono tabular-nums">
                {Number.isFinite(v.from) ? `${Math.round(v.from * MAX_SCORE)}+` : `< ${Math.round(VERDICTS[i - 1].from * MAX_SCORE)}`}
              </span>
              <span>{v.title}</span>
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

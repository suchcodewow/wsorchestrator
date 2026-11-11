"use client";

/**
 * A reference row for the Current tab. When the search holds one particular
 * name, in any capitalization, a row for it appears a second later. Clicking
 * the row plays a full-screen animation over black, which Esc or a click
 * skips, and the page fades back without the row until the search changes
 * away and back.
 *
 * It is client-only: it never touches the list query, the API or the
 * database. To remove it, delete this file and the lines in current-view.tsx
 * that use it.
 */

import { motion, useReducedMotion } from "framer-motion";
import { Bird, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatDate } from "../../cohort-settings/format";

/** The name the search is matched against, and the row shows. */
const NAME = "Alfred Hitchcock";

const BTC_DATE = "1963-03-28";

/** Trimmed, with its spaces collapsed and case ignored, so any capitalization of the name matches. */
function matches(q: string): boolean {
  return q.trim().replace(/\s+/g, " ").toLowerCase() === NAME.toLowerCase();
}

/** Whether the row is showing, how to play the animation, and the animation itself while it plays. */
export function useReferenceRow(q: string) {
  const matched = matches(q);
  const [shown, setShown] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Searching for anything else hides the row, so the next match waits its second again.
  const [wasMatched, setWasMatched] = useState(matched);
  if (matched !== wasMatched) {
    setWasMatched(matched);
    if (!matched) setShown(false);
  }

  useEffect(() => {
    if (!matched) return;
    const id = setTimeout(() => setShown(true), 1000);
    return () => clearTimeout(id);
  }, [matched]);

  return {
    shown: matched && shown,
    play: () => setPlaying(true),
    // The row goes once the black hides it, or straight away if the animation is skipped before then.
    overlay: playing ? (
      <Flyover
        onCovered={() => setShown(false)}
        onDone={() => {
          setShown(false);
          setPlaying(false);
        }}
      />
    ) : null,
  };
}

/** Black, glowing faintly red; on a dark card, a dull grey that still reads against it. */
const ICON = "size-4 stroke-[2.5] text-zinc-950 drop-shadow-[0_0_2px_rgb(220_38_38/0.8)] dark:text-zinc-400";

/** The row, cell for cell with a candidate's; nothing on it can be changed, and a click anywhere plays the animation. */
export function ReferenceRow({ btcDate, onClick }: { btcDate: boolean; onClick: () => void }) {
  return (
    <tr onClick={onClick} className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/30">
      <td className="px-5 py-2 font-medium">
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            onClick();
          }}
          className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded-md px-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          {NAME}
        </button>
      </td>
      <td className="px-5 py-1">
        <span className="flex p-0.5">
          <Bird className={ICON} aria-label="Bird" />
        </span>
      </td>
      <td className="px-5 py-2">Director</td>
      {btcDate && <td className="whitespace-nowrap px-5 py-2 tabular-nums text-muted-foreground">{formatDate(BTC_DATE)}</td>}
    </tr>
  );
}

// A gull in silhouette: long swept wings, a forked tail.
// Each wing's poses share one shape of path, so framer-motion can morph between them.
type Wing = { up: string; mid: string; down: string };

const SIDE_NEAR: Wing = {
  up: "M78 30 C72 18 62 6 44 0 C56 14 60 24 60 32 Z",
  mid: "M78 30 C66 24 44 18 14 20 C38 26 54 30 60 33 Z",
  down: "M78 31 C70 40 60 50 48 60 C54 48 58 40 60 34 Z",
};
const SIDE_FAR: Wing = {
  up: "M84 28 C82 18 78 10 70 4 C74 14 74 22 72 30 Z",
  mid: "M84 28 C78 24 68 20 52 18 C64 24 70 28 72 31 Z",
  down: "M84 30 C82 38 78 44 72 50 C74 42 74 36 72 32 Z",
};
const SIDE_BODY = "M106 27 C100 23 88 24 76 27 L46 31 L30 26 L37 33 L30 40 L47 35 L78 35 C90 35 100 32 106 27 Z";

/** Head on, coming for you. */
const FRONT: Wing = {
  up: "M60 30 C52 20 38 6 14 2 C32 14 46 26 56 36 L60 40 L64 36 C74 26 88 14 106 2 C82 6 68 20 60 30 Z",
  mid: "M60 30 C50 26 34 24 6 28 C30 32 46 34 56 37 L60 40 L64 37 C74 34 90 32 114 28 C86 24 70 26 60 30 Z",
  down: "M60 32 C52 36 38 44 16 54 C34 50 48 42 56 38 L60 40 L64 38 C72 42 86 50 104 54 C82 44 68 36 60 32 Z",
};

function Flap({ wing, period, phase, className }: { wing: Wing; period: number; phase: number; className?: string }) {
  return (
    <motion.path
      className={className}
      initial={{ d: wing.mid }}
      animate={{ d: [wing.mid, wing.up, wing.mid, wing.down, wing.mid] }}
      transition={{ duration: period, delay: phase, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/** One white gull, `facing` "side" flying right (mirror it to fly left), or "front" flying at the viewer. */
function Gull({
  facing,
  period = 0.5,
  phase = 0,
  still = false,
}: {
  facing: "side" | "front";
  period?: number;
  phase?: number;
  still?: boolean;
}) {
  const wing = (w: Wing, className?: string) =>
    still ? <path d={w.mid} className={className} /> : <Flap wing={w} period={period} phase={phase} className={className} />;
  return (
    <svg viewBox="0 0 120 60" aria-hidden className="size-full overflow-visible fill-white">
      {facing === "side" ? (
        <>
          {wing(SIDE_FAR, "opacity-75")}
          <path d={SIDE_BODY} />
          {wing(SIDE_NEAR)}
        </>
      ) : (
        <>
          {wing(FRONT)}
          <ellipse cx="60" cy="36" rx="5" ry="8" />
          <circle cx="60" cy="29" r="4.5" />
        </>
      )}
    </svg>
  );
}

// The same flock every time: a seeded shuffle, not Math.random.
let seed = 7919;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

/** How long the black takes to fade in; every bird waits for it. */
const FADE_IN = 3;

/** When the flock sets off, how long each bird takes, and how far apart they leave. */
const FLOCK_AT = FADE_IN + 6.4;
const FLOCK_FOR = 4;
const FLOCK_SPREAD = 1.2;

const FLOCK = Array.from({ length: 48 }, () => {
  // Where it gathers, as a share of the screen, and how near it is.
  const gx = between(8, 92);
  const gy = between(10, 82);
  const size = between(26, 84);
  const edge = rand() < 0.4 ? "left" : rand() < 0.66 ? "right" : "top";
  const from =
    edge === "left"
      ? { x: -(gx + 12), y: between(-20, 20) }
      : edge === "right"
        ? { x: 112 - gx, y: between(-20, 20) }
        : { x: between(-25, 25), y: -(gy + 12) };
  return {
    gx,
    gy,
    size,
    from,
    // Each heads for the camera, so it slides out from the middle as it grows.
    to: { x: (gx - 50) * 1.6, y: (gy - 50) * 1.6 },
    tilt: between(-18, 18),
    mirrored: edge === "right" || (edge === "top" && from.x > 0),
    delay: FLOCK_AT + rand() * FLOCK_SPREAD,
    period: between(0.36, 0.62),
    phase: rand() * 0.4,
  };
});

/** When the last bird has gone past, and the black starts to lift. */
const ENDS_AT = FLOCK_AT + FLOCK_SPREAD + FLOCK_FOR;

/** The share of each bird's flight at which it arrives, turns to face you, turns fully, and is past you. */
const TIMES = [0, 0.4, 0.5, 0.56, 0.94, 1];

function Flyover({ onCovered, onDone }: { onCovered: () => void; onDone: () => void }) {
  const reduce = useReducedMotion();
  // How long the black takes to lift, once it starts: slowly at the end, quickly on Esc or a click.
  const [lift, setLift] = useState<number | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setLift(reduce ? 0.8 : 2.5), (reduce ? 1.2 : ENDS_AT) * 1000);
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && setLift(0.4);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [reduce]);

  return createPortal(
    <motion.div
      aria-hidden
      onClick={(ev) => {
        ev.stopPropagation();
        setLift(0.4);
      }}
      className="fixed inset-0 z-100 overflow-hidden bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: lift === null ? 1 : 0 }}
      transition={{ duration: lift ?? (reduce ? 0.3 : FADE_IN), ease: "easeInOut" }}
      onAnimationComplete={() => (lift === null ? onCovered() : onDone())}
    >
      {reduce ? (
        <div className="absolute top-1/2 left-1/2 h-12 w-24 -translate-1/2">
          <Gull facing="side" still />
        </div>
      ) : (
        <>
          {/* One crosses. */}
          <motion.div
            className="absolute top-[30vh] left-0 h-11 w-22"
            initial={{ x: "-15vw", y: "0vh" }}
            animate={{ x: "110vw", y: ["0vh", "-5vh", "2vh"] }}
            transition={{ delay: FADE_IN + 0.6, duration: 2.4, ease: "linear" }}
          >
            <Gull facing="side" period={0.55} />
          </motion.div>
          {/* Then another, nearer. */}
          <motion.div
            className="absolute top-[58vh] left-0 h-15 w-30"
            initial={{ x: "110vw", y: "0vh" }}
            animate={{ x: "-20vw", y: ["0vh", "3vh", "-4vh"] }}
            transition={{ delay: FADE_IN + 3.4, duration: 2.1, ease: "linear" }}
          >
            {/* Mirrored inside: CSS scale on the moving element would mirror its path too. */}
            <div className="size-full -scale-x-100">
              <Gull facing="side" period={0.45} phase={0.1} />
            </div>
          </motion.div>
          {/* Then all of them. */}
          {FLOCK.map((b, n) => (
            <motion.div
              key={n}
              className="absolute"
              style={{
                left: `${b.gx}vw`,
                top: `${b.gy}vh`,
                width: b.size,
                height: b.size / 2,
                marginLeft: -b.size / 2,
                marginTop: -b.size / 4,
              }}
              initial={{ x: `${b.from.x}vw`, y: `${b.from.y}vh`, scale: 0.5, rotate: b.tilt, opacity: 1 }}
              animate={{
                x: [`${b.from.x}vw`, "0vw", "0vw", "0vw", `${b.to.x * 0.9}vw`, `${b.to.x}vw`],
                y: [`${b.from.y}vh`, "0vh", "0vh", "0vh", `${b.to.y * 0.9}vh`, `${b.to.y}vh`],
                scale: [0.5, 0.6, 0.6, 0.6, 9, 12],
                rotate: [b.tilt, b.tilt * 0.4, 0, 0, 0, 0],
                opacity: [1, 1, 1, 1, 1, 0],
              }}
              transition={{
                delay: b.delay,
                duration: FLOCK_FOR,
                times: TIMES,
                ease: ["easeOut", "easeInOut", "easeInOut", "easeIn", "linear"],
              }}
            >
              {/* It turns: the side view gives way to the head-on one. */}
              <motion.div
                className={b.mirrored ? "absolute inset-0 -scale-x-100" : "absolute inset-0"}
                initial={{ opacity: 1 }}
                animate={{ opacity: [1, 1, 1, 0, 0, 0] }}
                transition={{ delay: b.delay, duration: FLOCK_FOR, times: TIMES }}
              >
                <Gull facing="side" period={b.period} phase={b.phase} />
              </motion.div>
              <motion.div
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0, 0, 1, 1, 1] }}
                transition={{ delay: b.delay, duration: FLOCK_FOR, times: TIMES }}
              >
                <Gull facing="front" period={b.period * 0.8} phase={b.phase} />
              </motion.div>
            </motion.div>
          ))}
        </>
      )}
    </motion.div>,
    document.body,
  );
}

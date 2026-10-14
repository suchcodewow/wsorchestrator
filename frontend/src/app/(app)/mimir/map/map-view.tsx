"use client";

/**
 * The concept map. Slides run along the top, the concepts they rely on in
 * course order along the bottom, a curve from each slide to each concept it
 * needs, and the groups and levels beneath. Point at a slide, concept, group
 * or level and its lines light up, with its details in a popup beside it (the
 * popup floats, so nothing on the page moves under the pointer); click one to
 * keep its lines lit. The level chips under the title filter the map to one
 * level's concepts and the slides that need them; press the chip again for
 * everything.
 *
 * Each concept with a video has a play button, a ring that fills as the video
 * is watched. A concept the coach has marked as known shows a check, and one it
 * has asked you to watch is flagged "Recommended".
 */

import "./map.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Star } from "lucide-react";
import { anchorFloating } from "@/lib/floating";
import {
  CANVAS_H,
  CONCEPT_H,
  CONCEPT_W,
  CONCEPT_Y,
  GROUP_Y,
  LEVEL_Y,
  SLIDE_W,
  SLIDE_Y,
  layoutMap,
  type MapLayout,
  type PlacedConcept,
} from "@/lib/mimir/map/layout";
import { NO_STATE, ringFraction, type ConceptState, type MapLevel, type PublicMap } from "@/lib/mimir/map/schema";
import { cn } from "@/lib/utils";
import { ProgressRing } from "./progress-ring";
import { VideoDialog } from "./video-dialog";

type Sel = { type: "slide"; id: number } | { type: "concept"; id: string } | { type: "group"; id: string } | { type: "level"; id: MapLevel };
/** What is being pointed at, and the element the popup sits beside. */
type Pointed = { sel: Sel; anchor: HTMLElement };
const same = (a: Sel | null, b: Sel) => a !== null && a.type === b.type && a.id === b.id;
const levelVar = (level: number) => ({ "--lc": `var(--l${level})` }) as React.CSSProperties;

export function MapView({ map, states: initialStates, videos }: { map: PublicMap; states: Record<string, ConceptState>; videos: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [filter, setFilter] = useState<MapLevel | null>(null);
  // The whole course, for what a concept or slide is; and what is shown now, for where it sits.
  const full = useMemo(() => layoutMap(map), [map]);
  const layout = useMemo(() => (filter ? layoutMap(map, filter) : full), [map, filter, full]);
  const byId = useMemo(() => new Map(full.concepts.map((c) => [c.id, c])), [full]);
  // The coach links here with ?play=<concept>: that concept's video opens at once, and the parameter comes off the address.
  const wanted = params.get("play");
  const startWith = wanted && videos && byId.get(wanted)?.video ? wanted : null;

  const [states, setStates] = useState(initialStates);
  const [hover, setHover] = useState<Pointed | null>(null);
  const [locked, setLocked] = useState<Sel | null>(startWith ? { type: "concept", id: startWith } : null);
  const [playing, setPlaying] = useState<string | null>(startWith);
  const scroller = useRef<HTMLDivElement>(null);
  const sel = locked ?? hover?.sel ?? null;
  const stateOf = (id: string) => states[id] ?? NO_STATE;
  const onState = useCallback((id: string, s: ConceptState) => setStates((prev) => ({ ...prev, [id]: s })), []);
  const levelName = (level: MapLevel) => map.levels.find((l) => l.level === level)?.name ?? `Level ${level * 100}`;
  const groupName = (id: string) => full.groups.find((g) => g.id === id)?.name ?? id;
  const groupBlurb = (id: string) => map.buckets.find((b) => b.id === id)?.blurb ?? "";

  // What the selection lights up.
  const lit = useMemo(() => {
    if (!sel) return null;
    const edges = layout.edges.filter((e) => {
      const c = byId.get(e.concept)!;
      if (sel.type === "slide") return e.slide === sel.id;
      if (sel.type === "concept") return e.concept === sel.id;
      if (sel.type === "group") return c.bucket === sel.id;
      return c.level === sel.id;
    });
    return {
      edges: new Set(edges.map((e) => `${e.slide}|${e.concept}`)),
      concepts: new Set(edges.map((e) => e.concept)),
      slides: new Set(edges.map((e) => e.slide)),
    };
  }, [sel, layout, byId]);

  useEffect(() => {
    if (params.get("play")) router.replace("/mimir/map", { scroll: false });
  }, [params, router]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || playing) return;
      setLocked(null);
      setHover(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [playing]);

  /** Show only one level's concepts and the slides that need them, or everything again. */
  function toggleFilter(level: MapLevel) {
    setHover(null);
    setLocked(null);
    setFilter((now) => (now === level ? null : level));
  }

  const wire = (s: Sel) => {
    const choose = () => (s.type === "level" ? toggleFilter(s.id) : setLocked(same(locked, s) ? null : s));
    return {
      onMouseEnter: (e: React.MouseEvent<HTMLElement>) => setHover({ sel: s, anchor: e.currentTarget }),
      onMouseLeave: () => setHover(null),
      onFocus: (e: React.FocusEvent<HTMLElement>) => setHover({ sel: s, anchor: e.currentTarget }),
      onBlur: () => setHover(null),
      onClick: choose,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      },
    };
  };

  function focusConcept(c: PlacedConcept) {
    // A concept outside the level being shown needs the whole map back to be found on it.
    const visible = !filter || filter === c.level;
    if (!visible) setFilter(null);
    setLocked({ type: "concept", id: c.id });
    const target = visible ? layout.concepts.find((k) => k.id === c.id) : full.concepts.find((k) => k.id === c.id);
    const el = scroller.current;
    if (target) el?.scrollTo({ left: Math.max(0, target.x - el.clientWidth / 2), behavior: "smooth" });
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  const playButton = (c: PlacedConcept, size: number, label?: string) => {
    if (!c.video) return null;
    const st = stateOf(c.id);
    const fraction = ringFraction(st, c.video.seconds);
    const pct = Math.round(fraction * 100);
    const what = st.completed ? "Watched. Play again" : pct > 0 ? `Resume (${pct}% watched)` : "Play video";
    return (
      <button
        type="button"
        className="mm-play"
        style={levelVar(c.level)}
        disabled={!videos}
        title={videos ? what : "Videos aren't set up on this server"}
        aria-label={`${what}: ${c.name}`}
        onClick={(e) => {
          e.stopPropagation();
          setPlaying(c.id);
        }}
      >
        <ProgressRing fraction={fraction} completed={st.completed} size={size} />
        {label && <span className="text-sm font-medium text-foreground">{label}</span>}
      </button>
    );
  };

  const concepts = layout.concepts;
  const mastered = full.concepts.filter((c) => stateOf(c.id).mastered).length;

  return (
    <div className="mm space-y-6">
      <div className="space-y-3">
        <h2 className="text-xl font-medium tracking-tight">{map.title}</h2>
        <p className="text-sm text-muted-foreground tnum">
          <span className="font-medium text-foreground">
            {mastered} of {full.concepts.length}
          </span>{" "}
          concepts mastered
        </p>
        <div className="flex flex-wrap gap-2 text-[13px]" role="group" aria-label="Filter the map by level">
          {map.levels.map((l) => {
            const on = filter === l.level;
            return (
              <button
                key={l.level}
                type="button"
                aria-pressed={on}
                onClick={() => toggleFilter(l.level)}
                className={cn(
                  "inline-flex items-center rounded-md border px-2.5 py-1 transition-colors hover:bg-muted",
                  on ? "border-[var(--lc)] bg-[color-mix(in_srgb,var(--lc)_16%,var(--card))] font-medium text-foreground" : "bg-card",
                )}
                style={levelVar(l.level)}
              >
                <i className="mm-dot" style={{ background: `var(--l${l.level})` }} />
                {l.name}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={scroller} className="mm-scroll" tabIndex={0} aria-label="Concept map. Scroll sideways to move across the slides.">
        <div className={cn("mm-canvas", sel && "mm-sel")} style={{ width: layout.width, height: CANVAS_H }}>
          <svg className="mm-edges" viewBox={`0 0 ${layout.width} ${CANVAS_H}`} xmlns="http://www.w3.org/2000/svg" aria-hidden>
            {layout.edges.map((e) => (
              <path key={`${e.slide}|${e.concept}`} d={e.d} className={cn("mm-e", `mm-l${e.level}`, lit?.edges.has(`${e.slide}|${e.concept}`) && "mm-on")} />
            ))}
          </svg>

          {layout.bands.map((b) => (
            <div key={b.name} className="mm-band" style={{ background: `var(--s${b.band})`, left: b.left, width: b.width }}>
              {filter ? `${b.name} (${b.count} ${b.count === 1 ? "slide" : "slides"})` : `${b.name} (slides ${b.from}-${b.to})`}
            </div>
          ))}

          {layout.slides.map((n) => {
            const lv = layout.need[n];
            const title = map.slides.find((s) => s.n === n)?.title ?? "";
            return (
              <div
                key={n}
                role="button"
                tabIndex={0}
                aria-label={`Slide ${n}: ${title}`}
                className={cn("mm-slide", !lv && "mm-empty", lit?.slides.has(n) && "mm-on")}
                style={{ left: layout.slideX(n) - SLIDE_W / 2, top: SLIDE_Y, ["--ln" as string]: `var(--l${lv ?? 0})` }}
                {...wire({ type: "slide", id: n })}
              >
                <b>{n}</b>
                {title}
                <span className="mm-tag">{lv ? `Needs L${lv * 100}` : "No concepts"}</span>
              </div>
            );
          })}

          {concepts.map((c) => {
            const st = stateOf(c.id);
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                aria-label={`${c.study}. ${c.name}${st.mastered ? ", mastered" : ""}${st.recommended ? ", recommended" : ""}`}
                className={cn("mm-concept", lit?.concepts.has(c.id) && "mm-on", st.recommended && "mm-recommended")}
                style={{ left: c.x - CONCEPT_W / 2, top: CONCEPT_Y, height: CONCEPT_H, ...levelVar(c.level) }}
                {...wire({ type: "concept", id: c.id })}
              >
                <span className="mm-st">{c.study}</span>
                {c.name}
                <span className="mm-n">
                  {c.slides.length} {c.slides.length === 1 ? "slide" : "slides"}
                </span>
                {st.recommended && <span className="mm-flag">★ Recommended</span>}
                {st.mastered && <Check className="mm-done size-3.5" strokeWidth={3} aria-hidden />}
                {c.video && <div className="mm-play-slot">{playButton(c, 30)}</div>}
              </div>
            );
          })}

          {layout.groups.map((g) => (
            <div
              key={g.index}
              role="button"
              tabIndex={0}
              className={cn("mm-group", lit && g.concepts.some((id) => lit.concepts.has(id)) && "mm-on")}
              style={{ left: g.x0, width: g.x1 - g.x0, top: GROUP_Y, ...levelVar(g.level) }}
              {...wire({ type: "group", id: g.id })}
            >
              {g.name}
              {g.sub ? ` (${g.sub})` : ""}
            </div>
          ))}
          {layout.levels.map((l) => (
            <div
              key={l.level}
              role="button"
              tabIndex={0}
              aria-pressed={filter === l.level}
              className={cn("mm-level", lit && concepts.some((c) => c.level === l.level && lit.concepts.has(c.id)) && "mm-on")}
              style={{ left: l.x0, width: l.x1 - l.x0, top: LEVEL_Y, ...levelVar(l.level) }}
              {...wire({ type: "level", id: l.level })}
            >
              {levelName(l.level)}
            </div>
          ))}
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-medium tracking-tight">What each concept means</h2>
        {map.levels.map((l) => (
          <div key={l.level} className="space-y-3">
            <div>
              <h3 className="flex items-center text-lg font-semibold">
                <i className="mm-dot" style={{ background: `var(--l${l.level})` }} />
                {l.name}
              </h3>
              {l.blurb && <p className="text-sm text-muted-foreground">{l.blurb}</p>}
            </div>
            {full.groups
              .filter((g) => g.level === l.level)
              .map((g) => (
                <div key={g.index} className="space-y-2">
                  <div>
                    <h4 className="text-[15px] font-semibold">
                      {g.name}
                      {g.sub ? ` (${g.sub})` : ""}
                    </h4>
                    {groupBlurb(g.id) && <p className="text-sm text-muted-foreground">{groupBlurb(g.id)}</p>}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {g.concepts.map((id) => {
                      const c = byId.get(id);
                      if (!c) return null;
                      const st = stateOf(c.id);
                      return (
                        <article
                          key={c.id}
                          className={cn(
                            "flex flex-col gap-2 rounded-xl border border-l-[5px] bg-card p-4",
                            lit?.concepts.has(c.id) && "outline-2 outline-offset-0 outline-foreground",
                            st.recommended && "border-[var(--flag)]",
                          )}
                          style={{ borderLeftColor: `var(--l${c.level})`, ...levelVar(c.level) }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <h5 className="font-semibold">{c.name}</h5>
                            <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
                              {st.mastered && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
                                  <Check className="size-3" strokeWidth={3} /> Mastered
                                </span>
                              )}
                              {st.recommended && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-400">
                                  <Star className="size-3 fill-current" /> Recommended
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground tnum">
                            Study #{c.study} · {c.slides.length} {c.slides.length === 1 ? "slide" : "slides"}: {c.slides.join(", ")}
                          </p>
                          <p className="text-sm">{c.explanation}</p>
                          <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
                            {playButton(c, 34, "Play video")}
                            <button type="button" className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => focusConcept(c)}>
                              Show on the map
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        ))}
      </section>

      {hover && <Popup pointed={hover} full={full} map={map} stateOf={stateOf} levelName={levelName} groupName={groupName} groupBlurb={groupBlurb} />}

      {playing && byId.get(playing) && (
        <VideoDialog conceptId={playing} name={byId.get(playing)!.name} onClose={() => setPlaying(null)} onState={onState} />
      )}
    </div>
  );
}

/**
 * What is being pointed at, in a popup beside it. It floats over the page and
 * takes no pointer events, so it can never move what is under the pointer or
 * be hovered itself; it flips and slides to stay on screen.
 */
function Popup({
  pointed,
  full,
  map,
  stateOf,
  levelName,
  groupName,
  groupBlurb,
}: {
  pointed: Pointed;
  full: MapLayout;
  map: PublicMap;
  stateOf: (id: string) => ConceptState;
  levelName: (level: MapLevel) => string;
  groupName: (id: string) => string;
  groupBlurb: (id: string) => string;
}) {
  const { sel, anchor } = pointed;
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!box.current) return;
    return anchorFloating(anchor, box.current, { placement: "bottom-start", gap: 10, maxHeight: 440 });
  }, [anchor, sel]);

  const chip = (c: PlacedConcept) => (
    <span key={c.id} className="mm-chip" style={{ borderLeftColor: `var(--l${c.level})` }}>
      {c.study}. {c.name}
    </span>
  );
  const head = "text-[15px] font-semibold";
  const meta = "text-xs text-muted-foreground tnum";

  let body: React.ReactNode;
  if (sel.type === "slide") {
    const slide = map.slides.find((s) => s.n === sel.id);
    const needs = full.concepts.filter((c) => c.slides.includes(sel.id));
    const lv = full.need[sel.id];
    body = (
      <>
        <p className={head}>
          Slide {sel.id}: {slide?.title}
        </p>
        <p className={meta}>{lv ? `Needs up to Level ${lv * 100} · ${needs.length} concepts` : "No technical concepts"}</p>
        {needs.length ? (
          <div className="flex flex-wrap gap-1.5 pt-1">{needs.map(chip)}</div>
        ) : (
          <p>A divider, closing or internal slide, so it needs no technical background.</p>
        )}
      </>
    );
  } else if (sel.type === "concept") {
    const c = full.concepts.find((k) => k.id === sel.id)!;
    const st = stateOf(c.id);
    body = (
      <>
        <p className={head}>
          {c.study}. {c.name}
        </p>
        <p className={meta}>
          Level {c.level * 100} · {groupName(c.bucket)} · {c.slides.length} {c.slides.length === 1 ? "slide" : "slides"}: {c.slides.join(", ")}
        </p>
        <p>{c.explanation}</p>
        {(st.mastered || st.recommended) && (
          <p className={cn("text-xs font-medium", st.mastered ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
            {st.mastered ? "✓ Mastered" : "★ Recommended: watch the video"}
          </p>
        )}
      </>
    );
  } else if (sel.type === "group") {
    const cs = full.concepts.filter((c) => c.bucket === sel.id);
    const used = new Set(cs.flatMap((c) => c.slides)).size;
    body = (
      <>
        <p className={head}>{groupName(sel.id)}</p>
        <p className={meta}>
          Level {(cs[0]?.level ?? 1) * 100} · {cs.length} concepts · used on {used} slides
        </p>
        {groupBlurb(sel.id) && <p>{groupBlurb(sel.id)}</p>}
        <div className="flex flex-wrap gap-1.5 pt-1">{cs.map(chip)}</div>
      </>
    );
  } else {
    const cl = full.concepts.filter((c) => c.level === sel.id);
    const used = new Set(cl.flatMap((c) => c.slides)).size;
    const blurb = map.levels.find((l) => l.level === sel.id)?.blurb;
    body = (
      <>
        <p className={head}>{levelName(sel.id)}</p>
        <p className={meta}>
          {cl.length} concepts · used on {used} slides · click to show only these
        </p>
        {blurb && <p>{blurb}</p>}
      </>
    );
  }

  return (
    <div
      ref={box}
      role="tooltip"
      className="pointer-events-none fixed top-0 left-0 z-50 w-96 space-y-1.5 overflow-hidden rounded-xl border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
    >
      {body}
    </div>
  );
}

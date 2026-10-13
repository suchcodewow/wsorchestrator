"use client";

/**
 * The concept map. Slides run along the top, the concepts they rely on in
 * course order along the bottom, a curve from each slide to each concept it
 * needs, and the groups and levels beneath. Point at, or tap, a slide, concept,
 * group or level to isolate its lines; tap again to lock it.
 *
 * Each concept with a video has a play button, a ring that fills as the video
 * is watched. A concept the coach has marked as known shows a check, and one it
 * has asked you to watch is flagged "Recommended".
 */

import "./map.css";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Star } from "lucide-react";
import {
  CANVAS_H,
  CONCEPT_H,
  CONCEPT_W,
  CONCEPT_Y,
  GROUP_Y,
  LEVEL_Y,
  PAD,
  SLIDE_W,
  SLIDE_Y,
  layoutMap,
  type PlacedConcept,
} from "@/lib/mimir/map/layout";
import { NO_STATE, ringFraction, type ConceptState, type MapLevel, type PublicMap } from "@/lib/mimir/map/schema";
import { cn } from "@/lib/utils";
import { ProgressRing } from "./progress-ring";
import { VideoDialog } from "./video-dialog";

type Sel = { type: "slide"; id: number } | { type: "concept"; id: string } | { type: "group"; id: string } | { type: "level"; id: MapLevel };
const same = (a: Sel | null, b: Sel) => a !== null && a.type === b.type && a.id === b.id;
const levelVar = (level: number) => ({ "--lc": `var(--l${level})` }) as React.CSSProperties;

export function MapView({ map, states: initialStates, videos }: { map: PublicMap; states: Record<string, ConceptState>; videos: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const layout = useMemo(() => layoutMap(map), [map]);
  const byId = useMemo(() => new Map(layout.concepts.map((c) => [c.id, c])), [layout]);
  // The coach links here with ?play=<concept>: that concept's video opens at once, and the parameter comes off the address.
  const wanted = params.get("play");
  const startWith = wanted && videos && byId.get(wanted)?.video ? wanted : null;

  const [states, setStates] = useState(initialStates);
  const [hover, setHover] = useState<Sel | null>(null);
  const [locked, setLocked] = useState<Sel | null>(startWith ? { type: "concept", id: startWith } : null);
  const [playing, setPlaying] = useState<string | null>(startWith);
  const scroller = useRef<HTMLDivElement>(null);
  const sel = locked ?? hover;
  const stateOf = (id: string) => states[id] ?? NO_STATE;
  const onState = useCallback((id: string, s: ConceptState) => setStates((prev) => ({ ...prev, [id]: s })), []);
  const levelName = (level: MapLevel) => map.levels.find((l) => l.level === level)?.name ?? `Level ${level * 100}`;
  const groupName = (id: string) => layout.groups.find((g) => g.id === id)?.name ?? id;
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

  function play(id: string) {
    setPlaying(id);
  }

  useEffect(() => {
    if (params.get("play")) router.replace("/mimir/map", { scroll: false });
  }, [params, router]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && !playing && setLocked(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [playing]);

  const wire = (s: Sel) => ({
    onMouseEnter: () => !locked && setHover(s),
    onMouseLeave: () => !locked && setHover(null),
    onClick: () => setLocked(same(locked, s) ? null : s),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setLocked(same(locked, s) ? null : s);
      }
    },
  });

  function focusConcept(c: PlacedConcept) {
    setLocked({ type: "concept", id: c.id });
    const el = scroller.current;
    el?.scrollTo({ left: Math.max(0, c.x - el.clientWidth / 2), behavior: "smooth" });
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
          play(c.id);
        }}
      >
        <ProgressRing fraction={fraction} completed={st.completed} size={size} />
        {label && <span className="text-sm font-medium text-foreground">{label}</span>}
      </button>
    );
  };

  const chip = (c: PlacedConcept) => (
    <span key={c.id} className="mm-chip" style={{ borderLeftColor: `var(--l${c.level})` }}>
      {c.study}. {c.name}
    </span>
  );

  const slideCount = map.slides.length;
  const concepts = layout.concepts;
  const mastered = concepts.filter((c) => stateOf(c.id).mastered).length;

  return (
    <div className="mm space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-medium tracking-tight">{map.title}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          <span className="font-medium text-foreground tnum">
            {mastered} of {concepts.length}
          </span>{" "}
          concepts mastered. They run in course order, left to right, from foundations to technical differentiators; each line runs from one of{" "}
          {slideCount} slides to a concept it relies on. Point at a slide, concept, group or level to isolate its lines, and tap to lock it.
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[13px]">
          {map.levels.map((l) => (
            <span
              key={l.level}
              className="inline-flex cursor-pointer items-center rounded-md border bg-card px-2 py-0.5"
              {...wire({ type: "level", id: l.level })}
              role="button"
              tabIndex={0}
            >
              <i className="mm-dot" style={{ background: `var(--l${l.level})` }} />
              {l.name}
            </span>
          ))}
          <span className="inline-flex items-center rounded-md border bg-card px-2 py-0.5">
            <i className="mm-dot" style={{ background: "var(--l0)" }} />
            Slide needs no technical concepts
          </span>
          {map.capstone && (
            <span className="inline-flex items-center rounded-md border bg-card px-2 py-0.5">
              <i className="mm-dot" style={{ background: "var(--l4)" }} />
              Level 400: {map.capstone.title} (below the map)
            </span>
          )}
        </div>
      </div>

      <Info
        sel={sel}
        locked={locked !== null}
        onClear={() => setLocked(null)}
        map={map}
        layout={layout}
        stateOf={stateOf}
        levelName={levelName}
        groupName={groupName}
        groupBlurb={groupBlurb}
        chip={chip}
        playButton={playButton}
      />

      <div ref={scroller} className="mm-scroll" tabIndex={0} aria-label="Concept map. Scroll sideways to move across the slides.">
        <div className={cn("mm-canvas", sel && "mm-sel")} style={{ width: layout.width, height: CANVAS_H }}>
          <svg className="mm-edges" viewBox={`0 0 ${layout.width} ${CANVAS_H}`} xmlns="http://www.w3.org/2000/svg" aria-hidden>
            {layout.edges.map((e) => (
              <path key={`${e.slide}|${e.concept}`} d={e.d} className={cn("mm-e", `mm-l${e.level}`, lit?.edges.has(`${e.slide}|${e.concept}`) && "mm-on")} />
            ))}
          </svg>

          {map.sections.map((s) => (
            <div
              key={s.name}
              className="mm-band"
              style={{ background: `var(--s${s.band})`, left: PAD + layout.slideSpacing * (s.from - 1) + 1, width: layout.slideSpacing * (s.to - s.from + 1) - 6 }}
            >
              {s.name} (slides {s.from}-{s.to})
            </div>
          ))}

          {map.slides.map((s) => {
            const lv = layout.need[s.n];
            return (
              <div
                key={s.n}
                role="button"
                tabIndex={0}
                aria-label={`Slide ${s.n}: ${s.title}`}
                className={cn("mm-slide", !lv && "mm-empty", lit?.slides.has(s.n) && "mm-on")}
                style={{ left: layout.slideX(s.n) - SLIDE_W / 2, top: SLIDE_Y, ["--ln" as string]: `var(--l${lv ?? 0})` }}
                {...wire({ type: "slide", id: s.n })}
              >
                <b>{s.n}</b>
                {s.title}
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
              className={cn("mm-level", lit && concepts.some((c) => c.level === l.level && lit.concepts.has(c.id)) && "mm-on")}
              style={{ left: l.x0, width: l.x1 - l.x0, top: LEVEL_Y, ...levelVar(l.level) }}
              {...wire({ type: "level", id: l.level })}
            >
              {levelName(l.level)}
            </div>
          ))}
        </div>
      </div>

      {map.capstone && (
        <section className="space-y-3 rounded-2xl border border-l-[6px] bg-card p-5" style={{ borderLeftColor: "var(--l4)" }}>
          <h2 className="text-xl font-medium tracking-tight">Level 400: {map.capstone.title}</h2>
          {map.capstone.intro && <p className="text-sm">{map.capstone.intro}</p>}
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {map.capstone.steps.map((s, i) => (
              <li key={i}>
                {s.text} {s.slides && <span className="text-muted-foreground">({s.slides})</span>}
              </li>
            ))}
          </ol>
          {map.capstone.teachBack && <p className="text-sm">{map.capstone.teachBack}</p>}
        </section>
      )}

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
            {layout.groups
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

      {playing && byId.get(playing) && (
        <VideoDialog conceptId={playing} name={byId.get(playing)!.name} onClose={() => setPlaying(null)} onState={onState} />
      )}
    </div>
  );
}

/** What is selected, in words, with its play button when it is a concept. */
function Info({
  sel,
  locked,
  onClear,
  map,
  layout,
  stateOf,
  levelName,
  groupName,
  groupBlurb,
  chip,
  playButton,
}: {
  sel: Sel | null;
  locked: boolean;
  onClear: () => void;
  map: PublicMap;
  layout: ReturnType<typeof layoutMap>;
  stateOf: (id: string) => ConceptState;
  levelName: (level: MapLevel) => string;
  groupName: (id: string) => string;
  groupBlurb: (id: string) => string;
  chip: (c: PlacedConcept) => React.ReactNode;
  playButton: (c: PlacedConcept, size: number, label?: string) => React.ReactNode;
}) {
  const clear = locked && (
    <button type="button" onClick={onClear} className="ml-auto rounded-md border bg-card px-2.5 py-0.5 text-xs hover:bg-muted">
      Clear
    </button>
  );
  const box = "min-h-24 space-y-1.5 rounded-xl border bg-card px-4 py-3 text-sm";
  const head = "flex flex-wrap items-baseline gap-x-3 gap-y-1";
  const meta = "text-xs text-muted-foreground tnum";

  if (!sel) {
    return (
      <div className={box} aria-live="polite">
        <div className={head}>
          <strong className="text-[15px]">Nothing selected</strong>
        </div>
        <p>Point at or tap a slide to see the concepts it needs, a concept to see every slide that uses it, or a group or level to see everything connected to it.</p>
      </div>
    );
  }
  if (sel.type === "slide") {
    const slide = map.slides.find((s) => s.n === sel.id)!;
    const needs = layout.concepts.filter((c) => c.slides.includes(sel.id));
    const lv = layout.need[sel.id];
    return (
      <div className={box} aria-live="polite">
        <div className={head}>
          <strong className="text-[15px]">
            Slide {sel.id}: {slide.title}
          </strong>
          <span className={meta}>{lv ? `Needs up to Level ${lv * 100} · ${needs.length} concepts` : "No technical concepts"}</span>
          {clear}
        </div>
        {needs.length ? (
          <div className="flex flex-wrap gap-1.5 pt-1">{needs.map(chip)}</div>
        ) : (
          <p>This slide is a divider, closing or internal slide, so it needs no technical background.</p>
        )}
      </div>
    );
  }
  if (sel.type === "concept") {
    const c = layout.concepts.find((k) => k.id === sel.id)!;
    const st = stateOf(c.id);
    return (
      <div className={box} aria-live="polite">
        <div className={head}>
          <strong className="text-[15px]">
            {c.study}. {c.name}
          </strong>
          <span className={meta}>
            Level {c.level * 100} · {groupName(c.bucket)} · {c.slides.length} {c.slides.length === 1 ? "slide" : "slides"}: {c.slides.join(", ")}
          </span>
          {clear}
        </div>
        <p>{c.explanation}</p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {playButton(c, 34, "Play video")}
          {st.mastered && <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">✓ Mastered</span>}
          {st.recommended && <span className="text-xs font-medium text-amber-700 dark:text-amber-400">★ Recommended: watch the video</span>}
        </div>
      </div>
    );
  }
  if (sel.type === "group") {
    const cs = layout.concepts.filter((c) => c.bucket === sel.id);
    const used = new Set(cs.flatMap((c) => c.slides)).size;
    return (
      <div className={box} aria-live="polite">
        <div className={head}>
          <strong className="text-[15px]">{groupName(sel.id)}</strong>
          <span className={meta}>
            Level {(cs[0]?.level ?? 1) * 100} · {cs.length} concepts · used on {used} slides
          </span>
          {clear}
        </div>
        {groupBlurb(sel.id) && <p>{groupBlurb(sel.id)}</p>}
        <div className="flex flex-wrap gap-1.5 pt-1">{cs.map(chip)}</div>
      </div>
    );
  }
  const cl = layout.concepts.filter((c) => c.level === sel.id);
  const used = new Set(cl.flatMap((c) => c.slides)).size;
  const tagged = Object.values(layout.need).filter((l) => l === sel.id).length;
  return (
    <div className={box} aria-live="polite">
      <div className={head}>
        <strong className="text-[15px]">{levelName(sel.id)}</strong>
        <span className={meta}>
          {cl.length} concepts · used on {used} slides · {tagged} slides need this as their highest level
        </span>
        {clear}
      </div>
      {map.levels.find((l) => l.level === sel.id)?.blurb && <p>{map.levels.find((l) => l.level === sel.id)!.blurb}</p>}
    </div>
  );
}

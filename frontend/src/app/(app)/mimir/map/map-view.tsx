"use client";

/**
 * The concept map. The slides (EMD) are the first column, then a column of
 * concepts for each level, Level 100 to Level 300, each under its level and
 * group names. A curve runs from each slide to each concept it needs, and from
 * each concept back to the lower-level concepts it requires. Point at a slide, concept, group
 * or level and its details appear in a popup beside it (the popup floats, so
 * nothing on the page moves under the pointer); click one to light its lines,
 * and click it again, or press Escape, to clear them. The chips under the
 * title filter the map to one section of the slides and the concepts they
 * rely on; press the chip again for everything. Lines show only for what is
 * clicked, unless "Show all connections" is on. Drag the empty map to pan it sideways.
 *
 * Each concept with a video has a play button, a ring that fills as the video
 * is watched. A concept the coach has marked as known shows a check, and one it
 * has asked you to watch is flagged "Recommended". The video library links
 * here with ?show=<concept> to open the map on that concept.
 */

import "./map.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { anchorFloating } from "@/lib/floating";
import {
  CONCEPT_H,
  PAD,
  SLIDE_H,
  layoutMap,
  type MapLayout,
  type PlacedConcept,
} from "@/lib/mimir/map/layout";
import { NO_STATE, type ConceptState, type MapLevel, type PublicMap } from "@/lib/mimir/map/schema";
import { cn } from "@/lib/utils";
import { PlayButton } from "./play-button";
import { VideoDialog } from "./video-dialog";

type Sel = { type: "slide"; id: number } | { type: "concept"; id: string } | { type: "group"; id: string } | { type: "level"; id: MapLevel };
/** What is being pointed at, and the element the popup sits beside. */
type Pointed = { sel: Sel; anchor: HTMLElement };
const same = (a: Sel | null, b: Sel) => a !== null && a.type === b.type && a.id === b.id;
/** A press on any of these is a click on the box, not the start of a drag across the empty map. */
const NOT_DRAGGABLE = ".mm-slide, .mm-concept, .mm-group, .mm-level, button";
/** How far the pointer moves, in pixels, before a press on the empty map counts as a drag. */
const DRAG_THRESHOLD = 4;
const levelVar = (level: number) => ({ "--lc": `var(--l${level})` }) as React.CSSProperties;

/** Stubbed progress for the section courses, in quarters done, in the order the sections are shown, until it is tracked for real. */
const STUB_QUARTERS = [2, 1];

/** A ring in four quarters, the first `done` of them filled, clockwise from the top. */
function CourseRing({ done }: { done: number }) {
  const r = 7;
  const arc = (q: number) => {
    const a0 = (q * 90 + 8 - 90) * (Math.PI / 180);
    const a1 = ((q + 1) * 90 - 8 - 90) * (Math.PI / 180);
    const pt = (a: number) => `${(9 + r * Math.cos(a)).toFixed(2)},${(9 + r * Math.sin(a)).toFixed(2)}`;
    return `M${pt(a0)} A${r},${r} 0 0 1 ${pt(a1)}`;
  };
  return (
    <svg className="mm-ring" viewBox="0 0 18 18" role="img" aria-label={`Course ${done * 25}% complete`}>
      {[0, 1, 2, 3].map((q) => (
        <path key={q} d={arc(q)} className={q < done ? "mm-ring-on" : undefined} />
      ))}
    </svg>
  );
}

export function MapView({
  map,
  states: initialStates,
  videos,
  slideImages,
}: {
  map: PublicMap;
  states: Record<string, ConceptState>;
  videos: boolean;
  /** The slide numbers that have a picture in this environment. */
  slideImages: number[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [filter, setFilter] = useState<string | null>(null);
  // Off, no line shows until something is clicked, and then only that thing's lines.
  const [showAll, setShowAll] = useState(false);
  // The whole course, for what a concept or slide is; and what is shown now, for where it sits.
  const full = useMemo(() => layoutMap(map), [map]);
  // The room the map is shown in, so a map narrower than it spreads out to use it all.
  const [room, setRoom] = useState(0);
  const hasImage = useMemo(() => new Set(slideImages), [slideImages]);
  const byId = useMemo(() => new Map(full.concepts.map((c) => [c.id, c])), [full]);
  // The coach links here with ?play=<concept>: that concept's video opens at once, and the parameter comes off the address.
  const wanted = params.get("play");
  const startWith = wanted && videos && byId.get(wanted)?.video ? wanted : null;
  // The video library links here with ?show=<concept>: that concept is clicked and scrolled to.
  const shown = params.get("show");
  const startOn = startWith ?? (shown && byId.has(shown) ? shown : null);

  const [states, setStates] = useState(initialStates);
  const [hover, setHover] = useState<Pointed | null>(null);
  const [locked, setLocked] = useState<Sel | null>(startOn ? { type: "concept", id: startOn } : null);
  const [playing, setPlaying] = useState<string | null>(startWith);
  // A clicked slide drops every concept it does not need.
  const onlySlide = locked?.type === "slide" ? locked.id : null;
  const layout = useMemo(() => layoutMap(map, filter, room, onlySlide), [map, filter, room, onlySlide]);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const stateOf = (id: string) => states[id] ?? NO_STATE;
  const onState = useCallback((id: string, s: ConceptState) => setStates((prev) => ({ ...prev, [id]: s })), []);
  const levelName = (level: MapLevel) => map.levels.find((l) => l.level === level)?.name ?? `Level ${level * 100}`;
  const groupName = (id: string) => full.groups.find((g) => g.id === id)?.name ?? id;
  const groupBlurb = (id: string) => map.buckets.find((b) => b.id === id)?.blurb ?? "";

  // What the selection lights up.
  const lit = useMemo(() => {
    if (!locked) return null;
    const picked = (id: string) => {
      const c = byId.get(id)!;
      if (locked.type === "concept") return id === locked.id;
      if (locked.type === "group") return c.bucket === locked.id;
      if (locked.type === "level") return c.level === locked.id;
      return false;
    };
    const edges = layout.edges.filter((e) => (locked.type === "slide" ? e.slide === locked.id : picked(e.concept)));
    // A slide lights only the concepts it needs; anything else lights the lines that leave or reach it, and the concepts at their far ends.
    const links = locked.type === "slide" ? [] : layout.links.filter((l) => picked(l.from) || picked(l.to));
    return {
      edges: new Set(edges.map((e) => `${e.slide}|${e.concept}`)),
      links: new Set(links.map((l) => `${l.from}|${l.to}`)),
      concepts: new Set([...edges.map((e) => e.concept), ...links.flatMap((l) => [l.from, l.to])]),
      slides: new Set(edges.map((e) => e.slide)),
    };
  }, [locked, layout, byId]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setRoom(el.clientWidth);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    if (params.get("play") || params.get("show")) router.replace("/mimir/map", { scroll: false });
  }, [params, router]);

  // Bring the concept the page opened on into view, once the map has its width.
  const toShow = useRef(startOn);
  useEffect(() => {
    const el = scroller.current;
    const target = toShow.current && layout.concepts.find((k) => k.id === toShow.current);
    if (!el || !room || !target) return;
    toShow.current = null;
    el.scrollTo({ left: Math.max(0, target.x - el.clientWidth / 2) });
  }, [layout, room]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || playing) return;
      setLocked(null);
      setHover(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [playing]);

  /** Show only one section of the slides and the concepts they rely on, or everything again. */
  function toggleFilter(section: string) {
    setHover(null);
    setLocked(null);
    setFilter((now) => (now === section ? null : section));
  }

  const wire = (s: Sel) => {
    const choose = () => setLocked(same(locked, s) ? null : s);
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

  // Drag the empty map sideways. A touch screen already pans it, so touch is left to the browser.
  function dragStart(e: PointerEvent<HTMLDivElement>) {
    const el = scroller.current;
    if (!el || e.pointerType === "touch" || e.button !== 0 || (e.target as Element).closest(NOT_DRAGGABLE)) return;
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
  }
  function dragMove(e: PointerEvent<HTMLDivElement>) {
    const el = scroller.current;
    const d = drag.current;
    if (!el || !d) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      d.moved = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add("mm-dragging");
    }
    el.scrollLeft = d.left - dx;
  }
  function dragEnd(e: PointerEvent<HTMLDivElement>) {
    const el = scroller.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el?.classList.remove("mm-dragging");
    drag.current = null;
  }

  const concepts = layout.concepts;

  return (
    <div className="mm space-y-6">
      <div className="space-y-3">
        <h2 className="text-xl font-medium tracking-tight">{map.title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-[13px]" role="group" aria-label="Filter the map by slide section">
          {map.sections.map((s) => {
            const on = filter === s.name;
            return (
              <button
                key={s.name}
                type="button"
                aria-pressed={on}
                onClick={() => toggleFilter(s.name)}
                className={cn(
                  "inline-flex items-center rounded-md border px-2.5 py-1 transition-colors hover:bg-muted",
                  on ? "border-[var(--lc)] bg-[color-mix(in_srgb,var(--lc)_16%,var(--card))] font-medium text-foreground" : "bg-card",
                )}
                style={{ "--lc": `var(--s${s.band})` } as React.CSSProperties}
              >
                <i className="mm-dot" style={{ background: `var(--s${s.band})` }} />
                {s.name}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={showAll}
            onClick={() => setShowAll((on) => !on)}
            className={cn("ml-auto inline-flex items-center rounded-md border px-2.5 py-1 transition-colors hover:bg-muted", showAll ? "bg-muted font-medium text-foreground" : "bg-card")}
          >
            <i className="mm-dot" style={{ background: showAll ? "var(--foreground)" : "transparent", border: "1px solid var(--foreground)" }} />
            Show all connections
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        className="mm-scroll mm-tall"
        tabIndex={0}
        aria-label="Concept map. Scroll sideways to move across the slides."
        onPointerDown={dragStart}
        onPointerMove={dragMove}
        onPointerUp={dragEnd}
        onPointerCancel={dragEnd}
      >
        <div className={cn("mm-canvas", locked && "mm-sel", !showAll && "mm-bare")} style={{ width: layout.width, height: layout.height }}>
          <svg className="mm-edges" viewBox={`0 0 ${layout.width} ${layout.height}`} xmlns="http://www.w3.org/2000/svg" aria-hidden>
            {layout.edges.map((e) => (
              <path key={`${e.slide}|${e.concept}`} d={e.d} className={cn("mm-e", `mm-l${e.level}`, lit?.edges.has(`${e.slide}|${e.concept}`) && "mm-on")} />
            ))}
            {layout.links.map((l) => (
              <path key={`${l.from}|${l.to}`} d={l.d} className={cn("mm-e mm-req", `mm-l${l.level}`, lit?.links.has(`${l.from}|${l.to}`) && "mm-on")} />
            ))}
          </svg>

          {layout.bands.map((b, i) => (
            <div key={b.name} className="mm-band" style={{ background: `var(--s${b.band})`, left: b.left, width: b.width, top: b.top, height: b.height }}>
              <span>{filter ? `${b.name} (${b.count} ${b.count === 1 ? "slide" : "slides"})` : `${b.name} (slides ${b.from}-${b.to})`}</span>
              {/* Stubs for now: the course link goes nowhere and the circle does not yet track anything. */}
              <div className="mm-course">
                <button type="button">Launch Mindsmith Course</button>
                <CourseRing done={STUB_QUARTERS[i] ?? 0} />
              </div>
            </div>
          ))}

          {layout.divider !== null && <div className="mm-divider" style={{ left: layout.divider, height: layout.height - 2 * PAD }} aria-hidden />}

          {layout.heading && (
            <div className="mm-heading" style={{ left: layout.heading.left, width: layout.heading.width, top: layout.heading.top }}>
              {layout.heading.label}
            </div>
          )}

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
                style={{ left: layout.slideX(n) - layout.slideW / 2, top: layout.slideY(n), width: layout.slideW, height: SLIDE_H, ["--ln" as string]: `var(--l${lv ?? 0})` }}
                {...wire({ type: "slide", id: n })}
              >
                <b>{n}</b>
                {title}
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
                style={{ left: c.x - layout.conceptW / 2, top: c.y, width: layout.conceptW, height: CONCEPT_H, ...levelVar(c.level) }}
                {...wire({ type: "concept", id: c.id })}
              >
                <span className="mm-st">{c.study}</span>
                {c.name}
                <span className="mm-n">
                  {c.slides.length} {c.slides.length === 1 ? "slide" : "slides"}
                </span>
                {st.recommended && <span className="mm-flag">★ Recommended</span>}
                {st.mastered && <Check className="mm-done size-3.5" strokeWidth={3} aria-hidden />}
                {c.video && (
                  <div className="mm-play-slot">
                    <PlayButton concept={c} state={st} videos={videos} size={30} onPlay={setPlaying} />
                  </div>
                )}
              </div>
            );
          })}

          {layout.groups.map((g) => (
            <div
              key={g.index}
              role="button"
              tabIndex={0}
              className={cn("mm-group", lit && g.concepts.some((id) => lit.concepts.has(id)) && "mm-on")}
              style={{ left: g.x0, width: g.x1 - g.x0, top: g.y, ...levelVar(g.level) }}
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
              style={{ left: l.x0, width: l.x1 - l.x0, top: l.y, ...levelVar(l.level) }}
              {...wire({ type: "level", id: l.level })}
            >
              {levelName(l.level)}
            </div>
          ))}
        </div>
      </div>

      {hover && <Popup pointed={hover} full={full} map={map} hasImage={hasImage} stateOf={stateOf} levelName={levelName} groupName={groupName} groupBlurb={groupBlurb} />}

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
  hasImage,
  stateOf,
  levelName,
  groupName,
  groupBlurb,
}: {
  pointed: Pointed;
  full: MapLayout;
  map: PublicMap;
  /** The slides that have a picture to show. */
  hasImage: Set<number>;
  stateOf: (id: string) => ConceptState;
  levelName: (level: MapLevel) => string;
  groupName: (id: string) => string;
  groupBlurb: (id: string) => string;
}) {
  const { sel, anchor } = pointed;
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!box.current) return;
    return anchorFloating(anchor, box.current, { placement: "bottom-start", gap: 10, maxHeight: sel.type === "slide" ? 700 : 440 });
  }, [anchor, sel]);

  const chip = (c: PlacedConcept) => (
    <span key={c.id} className="mm-chip" style={{ borderLeftColor: `var(--l${c.level})` }}>
      {c.study}. {c.name}
    </span>
  );
  const head = "text-[15px] font-semibold";
  const meta = "text-xs text-muted-foreground tnum";

  let body: React.ReactNode;
  // A slide with a picture shows it above its details, in a box of the picture's shape so the popup is its full height before the picture arrives.
  const picture = sel.type === "slide" && hasImage.has(sel.id);
  if (sel.type === "slide") {
    const slide = map.slides.find((s) => s.n === sel.id);
    // A slide shows only its picture; one without a picture shows nothing.
    body = picture && (
      <div className="-mx-1 aspect-video overflow-hidden rounded-md border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect to a private bucket, which next/image cannot optimize */}
        <img src={`/api/mimir/map/slides/${sel.id}`} alt={`Slide ${sel.id}: ${slide?.title ?? ""}`} className="size-full object-contain" />
      </div>
    );
  } else if (sel.type === "concept") {
    const c = full.concepts.find((k) => k.id === sel.id)!;
    const st = stateOf(c.id);
    const needed = (c.requires ?? []).flatMap((id) => full.concepts.find((k) => k.id === id) ?? []);
    body = (
      <>
        <p className={head}>
          {c.study}. {c.name}
        </p>
        <p>{c.explanation}</p>
        {needed.length > 0 && (
          <div className="space-y-1 pt-1">
            <p className={meta}>Understand first</p>
            <div className="flex flex-wrap gap-1.5">{needed.map(chip)}</div>
          </div>
        )}
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
          {cl.length} concepts · used on {used} slides · click to highlight them
        </p>
        {blurb && <p>{blurb}</p>}
      </>
    );
  }

  if (sel.type === "slide" && !picture) return null;

  return (
    <div
      ref={box}
      role="tooltip"
      className={cn(
        "pointer-events-none fixed top-0 left-0 z-50 space-y-1.5 overflow-hidden rounded-xl border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg",
        picture ? "w-[39rem] max-w-[95vw]" : "w-96",
      )}
    >
      {body}
    </div>
  );
}

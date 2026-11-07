import React, { useEffect, useState } from "react";
import { AbsoluteFill, Easing, Img, cancelRender, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from "remotion";
import { captureFile, type Box, type Capture, type ShotList, type Step } from "../lib/training";
import type { SceneDef, VideoDef } from "./Explainer";
import { LEVELS, useScene } from "./ui";

// Plays back one scene of a training video: the pictures cli/capture.ts took, a drawn cursor that travels to each
// step's target and clicks on the spoken phrase, and a camera that can zoom in on what is being shown.

/** Frames the cursor spends travelling to a target, arriving just before the phrase. */
const MOVE = 16;
/** Frames after a click before the page shows what it did. */
const AFTER_CLICK = 4;
/** Frames per typed character. */
const PER_CHAR = 3;
const FADE = 5;
const ZOOM_FRAMES = 22;
const RING_FRAMES = 75;

const captures = new Map<string, Promise<Capture>>();
const loadCapture = (id: string) => {
  if (!captures.has(id)) captures.set(id, fetch(staticFile(captureFile(id))).then((r) => r.json() as Promise<Capture>));
  return captures.get(id)!;
};

function useCapture(id: string): Capture | null {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [handle] = useState(() => delayRender(`capture ${id}`));
  useEffect(() => {
    loadCapture(id)
      .then((c) => {
        setCapture(c);
        continueRender(handle);
      })
      .catch((e) => cancelRender(new Error(`No capture for ${id}; run cli/capture.ts first. (${e})`)));
  }, [id, handle]);
  return capture;
}

type Shown = Exclude<Step, { do: "goto" }>;
type Point = { x: number; y: number };
const centre = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const smooth = (f: number, from: number, dur: number) =>
  interpolate(f, [from, from + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });

const Cursor: React.FC<{ at: Point }> = ({ at }) => (
  <svg width={44} height={44} viewBox="0 0 24 24" style={{ position: "absolute", left: at.x - 6, top: at.y - 3, filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.35))" }}>
    <path d="M5.5 3.2 L19 12.6 L12.6 13.6 L16 20.4 L13.4 21.6 L10 14.8 L5.5 19.2 Z" fill="#fff" stroke="#111" strokeWidth={1.3} strokeLinejoin="round" />
  </svg>
);

const SceneScreen: React.FC<{ id: string; scene: number; steps: Shown[]; from: Point }> = ({ id, scene, steps, from }) => {
  const frame = useCurrentFrame();
  const { at, accent } = useScene();
  const capture = useCapture(id);
  if (!capture) return null;
  const shot = capture.scenes[scene];
  if (!shot || shot.steps.length !== steps.length) {
    throw new Error(`The capture of ${id} has ${shot?.steps.length ?? 0} steps in scene ${scene + 1}, the video ${steps.length}; capture it again.`);
  }

  const times = steps.map((s) => at(s.at, s.nth));

  // Which picture shows when: each one from the frame its step finishes on.
  const pictures: { from: number; src: string; cut?: boolean }[] = [{ from: 0, src: shot.start }];
  steps.forEach((s, k) => {
    const t = times[k];
    const c = shot.steps[k];
    if (c.frames) {
      // Typing finishes before the next step starts its move, however long the text.
      const room = (k + 1 < steps.length ? times[k + 1] - MOVE - 4 : Infinity) - t - AFTER_CLICK;
      const per = Math.min(PER_CHAR, Math.max(0.5, room / (c.frames.length + 1)));
      c.frames.forEach((src, j) => pictures.push({ from: t + AFTER_CLICK + Math.round(j * per), src, cut: true }));
      pictures.push({ from: t + AFTER_CLICK + Math.round(c.frames.length * per), src: c.after, cut: true });
    } else {
      pictures.push({ from: s.do === "click" || s.do === "press" ? t + AFTER_CLICK : t, src: c.after });
    }
  });
  const current = pictures.reduce((n, p, i) => (p.from <= frame ? i : n), 0);
  const fadeIn = pictures[current].cut ? 1 : smooth(frame, pictures[current].from, FADE);

  // The cursor: from where it was, to each target in turn.
  let cursor = from;
  steps.forEach((_, k) => {
    const box = shot.steps[k].box;
    if (!box) return;
    const target = centre(box);
    const start = Math.max(times[k] - MOVE - 2, k > 0 ? times[k - 1] + 2 : 0);
    const p = smooth(frame, start, Math.max(4, times[k] - 2 - start));
    cursor = { x: cursor.x + (target.x - cursor.x) * p, y: cursor.y + (target.y - cursor.y) * p };
  });

  // The camera: each zoom eases in on its step's target and holds until the next.
  let cam = { scale: 1, cx: capture.width / 2, cy: capture.height / 2 };
  steps.forEach((s, k) => {
    if (s.zoom === undefined) return;
    const box = shot.steps[k].box;
    const target = box ? centre(box) : { x: cam.cx, y: cam.cy };
    const p = smooth(frame, times[k] - MOVE - ZOOM_FRAMES, ZOOM_FRAMES);
    cam = {
      scale: cam.scale + (s.zoom - cam.scale) * p,
      cx: cam.cx + (target.x - cam.cx) * p,
      cy: cam.cy + (target.y - cam.cy) * p,
    };
  });
  // Keep the picture filling the frame: the centre can go no nearer an edge than half the visible width.
  const halfW = capture.width / 2 / cam.scale;
  const halfH = capture.height / 2 / cam.scale;
  const cx = Math.min(Math.max(cam.cx, halfW), capture.width - halfW);
  const cy = Math.min(Math.max(cam.cy, halfH), capture.height - halfH);
  const transform = `scale(${cam.scale}) translate(${capture.width / 2 / cam.scale - cx}px, ${capture.height / 2 / cam.scale - cy}px)`;

  return (
    <AbsoluteFill style={{ background: "#fff", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform, transformOrigin: "0 0" }}>
        {current > 0 && <Img src={staticFile(pictures[current - 1].src)} style={{ position: "absolute", width: capture.width, height: capture.height }} />}
        <Img src={staticFile(pictures[current].src)} style={{ position: "absolute", width: capture.width, height: capture.height, opacity: fadeIn }} />

        {steps.map((s, k) => {
          const box = shot.steps[k].box;
          if (s.do !== "point" || !box) return null;
          const end = k + 1 < steps.length ? Math.min(times[k + 1], times[k] + RING_FRAMES) : times[k] + RING_FRAMES;
          const o = smooth(frame, times[k] - 4, 8) * (1 - smooth(frame, end - 8, 8));
          if (o <= 0) return null;
          const pad = 10;
          return (
            <div key={k} style={{ position: "absolute", left: box.x - pad, top: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2, borderRadius: 14, border: `4px solid ${accent}`, boxShadow: `0 0 0 6px ${accent}33`, opacity: o }} />
          );
        })}

        {steps.map((s, k) => {
          if (s.do !== "click" && s.do !== "type") return null;
          const p = interpolate(frame, [times[k], times[k] + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          if (p <= 0 || p >= 1) return null;
          const r = 10 + 34 * p;
          return <div key={k} style={{ position: "absolute", left: cursor.x - r, top: cursor.y - r, width: r * 2, height: r * 2, borderRadius: "50%", border: `4px solid ${accent}`, opacity: 1 - p }} />;
        })}

        <Cursor at={cursor} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * A training video: every scene is the app, played back from its capture. `scenes` are the steps per scene, in the
 * same order as the scene text files; `level` only sets the accent color of the cursor's rings.
 */
export function trainingVideo(id: string, shots: ShotList, level: keyof typeof LEVELS = 100): VideoDef {
  const scenes: SceneDef[] = shots.scenes.map((all, i) => {
    const steps = all.filter((s): s is Shown => s.do !== "goto");
    const Component: React.FC = () => <ChainedScene id={id} scene={i} steps={steps} />;
    return { Component };
  });
  return { level, scenes };
}

/** Where the cursor rests before a video's first step. */
const REST: Point = { x: 960, y: 620 };

/** Starts a scene's cursor where the previous scene's last targeted step left it. */
const ChainedScene: React.FC<{ id: string; scene: number; steps: Shown[] }> = ({ id, scene, steps }) => {
  const capture = useCapture(id);
  if (!capture) return null;
  const last = capture.scenes.slice(0, scene).flatMap((s) => s.steps).filter((s) => s.box).at(-1)?.box;
  return <SceneScreen id={id} scene={scene} steps={steps} from={last ? centre(last) : REST} />;
};

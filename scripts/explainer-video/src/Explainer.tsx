import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FINAL_TAIL_SECONDS, LEAD_SECONDS, TAIL_SECONDS, phraseEnd, phraseStart, placeSfx, type SceneTiming, type VideoTiming } from "../lib/timing";
import { C, FONT, LEVELS, SceneProvider } from "./ui";

/**
 * A sound effect wanted when a visual appears. `phrase` is the spoken text it is anchored to (`end` anchors it to
 * the end of the phrase). It is moved into the nearest silence in the narration and dropped if there is none close
 * enough, so it never plays over the voice.
 */
export type SfxCue = { sfx: string; phrase?: string; nth?: number; end?: boolean; offset?: number; volume?: number };

/** Narration-time seconds at which a cue wants to sound. */
export const cueTime = (scene: SceneTiming, cue: SfxCue) =>
  (cue.phrase ? (cue.end ? phraseEnd(scene, cue.phrase, cue.nth) : phraseStart(scene, cue.phrase, cue.nth)) : -LEAD_SECONDS) + (cue.offset ?? 0);
export type SceneDef = { Component: React.FC; sfx?: SfxCue[] };
export type VideoDef = {
  /** Sets the accent color (100 green, 200 blue, 300 purple, 400 amber). */
  level: keyof typeof LEVELS;
  scenes: SceneDef[]; // in the same order as the scene text files
  /** First and last scene (by index) over which the conveyor hum plays, with a fade at each end. */
  hum?: [number, number];
};

// The generated effects peak at full scale while the narration averages about -24 dB, so they are mixed well down.
const SFX_VOLUME = 0.16;
const HUM_VOLUME = 0.1;

export const sceneFrames = (timing: VideoTiming, fps: number) =>
  timing.scenes.map((s, i) =>
    Math.round((LEAD_SECONDS + s.duration + (i === timing.scenes.length - 1 ? FINAL_TAIL_SECONDS : TAIL_SECONDS)) * fps),
  );

export const Explainer: React.FC<{ def: VideoDef; timing: VideoTiming; sfxLengths: Record<string, number> }> = ({ def, timing, sfxLengths }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const lengths = sceneFrames(timing, fps);
  const starts = lengths.reduce<number[]>((acc, l, i) => [...acc, i === 0 ? 0 : acc[i - 1] + lengths[i - 1]], []);
  const level = LEVELS[def.level];

  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT, color: C.text }}>
      <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 0%, ${level.color}18, transparent 70%)` }} />

      {timing.scenes.map((scene, i) => {
        const { Component, sfx = [] } = def.scenes[i];
        const at = (phrase: string, nth = 0) => Math.round((LEAD_SECONDS + phraseStart(scene, phrase, nth)) * fps);
        const atEnd = (phrase: string, nth = 0) => Math.round((LEAD_SECONDS + phraseEnd(scene, phrase, nth)) * fps);
        return (
          <Sequence key={scene.key} from={starts[i]} durationInFrames={lengths[i]}>
            <SceneFade length={lengths[i]}>
              <SceneProvider value={{ at, atEnd, accent: level.color }}>
                <Component />
              </SceneProvider>
            </SceneFade>
            <Sequence from={Math.round(LEAD_SECONDS * fps)}>
              <Audio src={staticFile(scene.audio)} />
            </Sequence>
            {sfx.map((cue, k) => {
              const placed = placeSfx(scene, cueTime(scene, cue), sfxLengths[cue.sfx]);
              if (!placed) return null; // no silence close enough: stay quiet rather than talk over the narration
              const from = Math.round((LEAD_SECONDS + placed.start) * fps);
              const length = Math.max(2, Math.round(placed.length * fps));
              return (
                <Sequence key={k} from={from} durationInFrames={length}>
                  <Audio
                    src={staticFile(`audio/sfx/${cue.sfx}.mp3`)}
                    volume={(f) => (cue.volume ?? 1) * SFX_VOLUME * interpolate(f, [0, Math.max(1, length - 4), length], [1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
                  />
                </Sequence>
              );
            })}
          </Sequence>
        );
      })}

      {def.hum && (() => {
        const length = starts[def.hum[1]] + lengths[def.hum[1]] - starts[def.hum[0]];
        return (
          <Sequence from={starts[def.hum[0]]} durationInFrames={length}>
            <Audio
              src={staticFile("audio/sfx/conveyor.mp3")}
              loop
              volume={(f) => HUM_VOLUME * interpolate(f, [0, 20, length - 30, length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
            />
          </Sequence>
        );
      })()}

      {/* Progress bar, the only chrome that stays on screen across scenes */}
      <div style={{ position: "absolute", bottom: 0, left: 0, height: 8, width: `${(frame / durationInFrames) * 100}%`, background: level.color }} />
    </AbsoluteFill>
  );
};

const SceneFade: React.FC<{ length: number; children: React.ReactNode }> = ({ length, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, length - 8, length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

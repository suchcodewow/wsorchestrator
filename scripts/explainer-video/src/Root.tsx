import React from "react";
import { Composition, staticFile } from "remotion";
import { FPS, type VideoTiming } from "../lib/timing";
import { Explainer, sceneFrames, type VideoDef } from "./Explainer";

// Every src/videos/<id>.tsx (default export: a VideoDef) is a video; <id> matches its content/<id>/ folder.
// The videos directory is gitignored (the on-screen text is internal content), so nothing here names a video.
declare const require: { context(dir: string, deep: boolean, filter: RegExp): { keys(): string[]; (key: string): { default: VideoDef } } };
const context = require.context("./videos", false, /\.tsx$/);
export const VIDEOS: Record<string, VideoDef> = Object.fromEntries(context.keys().map((key) => [key.replace(/^\.\//, "").replace(/\.tsx$/, ""), context(key).default]));

type Props = { videoId: string; timing?: VideoTiming; sfxLengths?: Record<string, number> };

export const Root: React.FC = () => (
  <Composition
    id="Explainer"
    component={({ videoId, timing, sfxLengths }: Props) => <Explainer def={VIDEOS[videoId]} timing={timing!} sfxLengths={sfxLengths!} />}
    width={1920}
    height={1080}
    fps={FPS}
    durationInFrames={FPS * 10}
    defaultProps={{ videoId: Object.keys(VIDEOS)[0] } as Props}
    calculateMetadata={async ({ props }) => {
      const timing = (await (await fetch(staticFile(`audio/${props.videoId}/timing.json`))).json()) as VideoTiming;
      const sfxLengths = (await (await fetch(staticFile("audio/sfx/durations.json"))).json()) as Record<string, number>;
      return { durationInFrames: sceneFrames(timing, FPS).reduce((a, b) => a + b, 0), props: { ...props, timing, sfxLengths } };
    }}
  />
);

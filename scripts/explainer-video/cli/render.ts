// Renders a video headless with Remotion, using the installed Chrome (no browser download).
//   npx tsx cli/render.ts 01-pipelines              -> out/01-pipelines.mp4
//   npx tsx cli/render.ts 01-pipelines --stills 120,900,1800   -> out/stills/01-pipelines/frame-<n>.png
//   add --concurrency N (default 3) to cap the browser tabs used; several renders can run at once
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { ROOT } from "../lib/config.js";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const id = process.argv[2];
if (!id) throw new Error("Usage: tsx cli/render.ts <video-id> [--stills 10,200]");
const stillsArg = process.argv.indexOf("--stills");
const stills = stillsArg > -1 ? process.argv[stillsArg + 1].split(",").map(Number) : [];
const concArg = process.argv.indexOf("--concurrency");
const concurrency = concArg > -1 ? Number(process.argv[concArg + 1]) : 3;

const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/index.ts"), publicDir: path.join(ROOT, "public") });
const common = { browserExecutable: CHROME, chromeMode: "chrome-for-testing" as const };
const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps: { videoId: id }, ...common });
console.log(`${composition.durationInFrames} frames, ${(composition.durationInFrames / composition.fps).toFixed(1)}s`);

if (stills.length) {
  const dir = path.join(ROOT, "out/stills", id);
  mkdirSync(dir, { recursive: true });
  for (const frame of stills) {
    await renderStill({ composition, serveUrl, frame, output: path.join(dir, `frame-${frame}.png`), inputProps: { videoId: id }, ...common });
    console.log(`still ${frame}`);
  }
} else {
  mkdirSync(path.join(ROOT, "out"), { recursive: true });
  const output = path.join(ROOT, "out", `${id}.mp4`);
  const raw = path.join(ROOT, "out", `${id}.raw.mp4`);
  let last = -1;
  await renderMedia({
    composition, serveUrl, outputLocation: raw, concurrency, codec: "h264", audioCodec: "aac", inputProps: { videoId: id }, ...common,
    onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; console.log(`render ${p * 10}%`); } },
  });
  // Narration plus effects render quiet; bring the mix to a standard loudness without re-encoding the video.
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", raw, "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", output]);
  rmSync(raw);
  console.log(`wrote ${output}`);
}

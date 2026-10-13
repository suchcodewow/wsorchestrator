// Shows where each sound effect lands and checks that none of them overlaps the narration.
// Usage: npx tsx cli/sfx-report.ts 01-pipelines
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/config.js";
import { placeSfx, speechGaps, type VideoTiming } from "../lib/timing.js";
import { cueTime } from "../src/Explainer.js";

const id = process.argv[2];
const video = (await import(`../src/videos/${id}.tsx`)).default as import("../src/Explainer.js").VideoDef;
if (!id) throw new Error("Usage: tsx cli/sfx-report.ts <video-id>");
const timing = JSON.parse(readFileSync(path.join(ROOT, "public/audio", id, "timing.json"), "utf8")) as VideoTiming;
const lengths = JSON.parse(readFileSync(path.join(ROOT, "public/audio/sfx/durations.json"), "utf8")) as Record<string, number>;

let placed = 0, dropped = 0, overlaps = 0;
timing.scenes.forEach((scene, i) => {
  const gaps = speechGaps(scene);
  for (const cue of video.scenes[i].sfx ?? []) {
    const want = cueTime(scene, cue);
    const p = placeSfx(scene, want, lengths[cue.sfx]);
    const label = `scene ${i + 1}  ${cue.sfx.padEnd(8)} "${cue.phrase ?? "(scene start)"}"`;
    if (!p) { dropped++; console.log(`DROPPED  ${label}  (no silence within reach)`); continue; }
    placed++;
    const inside = gaps.some((g) => p.start >= g.start - 1e-6 && p.start + p.length <= g.end + 1e-6);
    if (!inside) overlaps++;
    console.log(`${inside ? "ok     " : "OVERLAP"}  ${label}  want ${want.toFixed(2)}s -> ${p.start.toFixed(2)}s (${(p.start - want >= 0 ? "+" : "") + (p.start - want).toFixed(2)}), ${p.length.toFixed(2)}s of ${lengths[cue.sfx].toFixed(2)}s`);
  }
});
console.log(`\n${placed} placed, ${dropped} dropped, ${overlaps} overlapping speech`);

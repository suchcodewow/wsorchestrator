// Writes a video's transcript from its narration timing: out/<id>.txt (the narration, a paragraph per scene) and
// out/<id>.vtt (captions, a sentence or so per cue, timed to the rendered video).
// Usage: npx tsx cli/transcript.ts guest-judge-schedule
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/config.js";
import { FPS, LEAD_SECONDS, type VideoTiming } from "../lib/timing.js";
import { sceneFrames } from "../src/Explainer.js";

const id = process.argv[2];
if (!id) throw new Error("Usage: tsx cli/transcript.ts <video-id>");
const timing = JSON.parse(readFileSync(path.join(ROOT, "public/audio", id, "timing.json"), "utf8")) as VideoTiming;

/** Longest caption cue, in characters; a sentence longer than this is split at a comma or a space. */
const MAX_CUE = 90;

const stamp = (s: number) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};

const lengths = sceneFrames(timing, FPS);
const cues: string[] = [];
let sceneStart = 0;
timing.scenes.forEach((scene, i) => {
  const text = scene.characters.join("");
  // Cue boundaries: after each sentence, and inside one that runs long.
  let from = 0;
  while (from < text.length) {
    while (from < text.length && /\s/.test(text[from]!)) from++;
    if (from >= text.length) break;
    let to = text.slice(from).search(/[.!?](\s|$)/);
    to = to < 0 ? text.length : from + to + 1;
    if (to - from > MAX_CUE) {
      const window = text.slice(from, from + MAX_CUE);
      const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf(": "));
      to = from + (cut > MAX_CUE / 3 ? cut + 1 : window.lastIndexOf(" "));
    }
    const start = sceneStart + LEAD_SECONDS + scene.starts[from]!;
    const end = sceneStart + LEAD_SECONDS + scene.ends[to - 1]!;
    cues.push(`${stamp(start)} --> ${stamp(end)}\n${text.slice(from, to).trim()}`);
    from = to;
  }
  sceneStart += lengths[i]! / FPS;
});

mkdirSync(path.join(ROOT, "out"), { recursive: true });
writeFileSync(path.join(ROOT, "out", `${id}.vtt`), `WEBVTT\n\n${cues.join("\n\n")}\n`);
writeFileSync(path.join(ROOT, "out", `${id}.txt`), timing.scenes.map((s) => s.characters.join("").trim()).join("\n\n") + "\n");
console.log(`${cues.length} cues -> out/${id}.vtt, transcript -> out/${id}.txt`);

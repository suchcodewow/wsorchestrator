// Narrates every scene of a video in the cloned voice and writes public/audio/<id>/timing.json.
// A scene is only regenerated when its text changes, so re-running costs nothing.
// Usage: npx tsx cli/narrate.ts 01-pipelines
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, TTS_MODEL, VOICE_ID } from "../lib/config.js";
import { speak } from "../lib/eleven.js";
import type { SceneTiming, VideoTiming } from "../lib/timing.js";

const probe = (file: string) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
const id = process.argv[2];
if (!id) throw new Error("Usage: tsx cli/narrate.ts <video-id>");

const srcDir = path.join(ROOT, "content", id);
const outDir = path.join(ROOT, "public/audio", id);
mkdirSync(outDir, { recursive: true });

const files = readdirSync(srcDir).filter((f) => /^scene-\d+-.*\.txt$/.test(f)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
const raws = files.map((f) => readFileSync(path.join(srcDir, f), "utf8").trim());
// A line like "[pause 2.8]" leaves that many seconds of silence (for a sound effect), then the narration continues.
const PAUSE = /\n?\[pause ([\d.]+)\]\n?/;
const texts = raws.map((r) => r.split(PAUSE).filter((_, k) => k % 2 === 0).join("\n"));
// Finished scenes are cached by text hash. They are saved to progress.json as each one completes, so a dropped
// connection or a rate limit part-way through never repeats work (or spends the credits twice).
const timingFile = path.join(outDir, "timing.json");
const progressFile = path.join(outDir, "progress.json");
const savedScenes = (file: string) => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as VideoTiming).scenes : []);
const cache = [...savedScenes(timingFile), ...savedScenes(progressFile)];

const scenes: SceneTiming[] = [];
for (let i = 0; i < files.length; i++) {
  const key = files[i].replace(/\.txt$/, "");
  const text = texts[i];
  const hash = createHash("sha256").update(`${VOICE_ID}|${TTS_MODEL}|${raws[i]}`).digest("hex").slice(0, 16);
  const audioRel = `audio/${id}/${key}.mp3`;
  const audioAbs = path.join(ROOT, "public", audioRel);
  const cached = cache.find((s) => s.key === key && s.hash === hash);
  if (cached && existsSync(audioAbs)) { scenes.push(cached); console.log(`skip   ${key} (unchanged)`); writeFileSync(progressFile, JSON.stringify({ id, scenes })); continue; }

  const parts = raws[i].split(PAUSE); // [segment, pauseSeconds, segment, ...]
  const segs = parts.filter((_, k) => k % 2 === 0);
  const pauses = parts.filter((_, k) => k % 2 === 1).map(Number);
  const characters: string[] = [], starts: number[] = [], ends: number[] = [];
  const inputs: string[] = [];
  let offset = 0;
  for (let k = 0; k < segs.length; k++) {
    const s = await speak(segs[k], k > 0 ? segs[k - 1] : texts[i - 1], k < segs.length - 1 ? segs[k + 1] : texts[i + 1]);
    const segFile = path.join(outDir, `${key}.seg${k}.mp3`);
    writeFileSync(segFile, s.audio);
    const segDur = probe(segFile);
    characters.push(...s.characters);
    starts.push(...s.starts.map((x) => x + offset));
    ends.push(...s.ends.map((x) => x + offset));
    inputs.push(segFile);
    offset += segDur;
    if (k < segs.length - 1) { characters.push(" "); starts.push(offset); ends.push(offset); }
    if (k < pauses.length) { inputs.push(`silence:${pauses[k]}`); offset += pauses[k]; }
  }
  if (inputs.length === 1) {
    renameSync(inputs[0], audioAbs);
  } else {
    const args = ["-y", "-v", "error"];
    for (const inp of inputs) args.push(...(inp.startsWith("silence:") ? ["-f", "lavfi", "-t", inp.slice(8), "-i", "anullsrc=r=44100:cl=mono"] : ["-i", inp]));
    args.push("-filter_complex", `${inputs.map((_, n) => `[${n}:a]aresample=44100,aformat=channel_layouts=mono`).map((x, n) => `${x}[a${n}]`).join(";")};${inputs.map((_, n) => `[a${n}]`).join("")}concat=n=${inputs.length}:v=0:a=1[out]`, "-map", "[out]", "-b:a", "128k", audioAbs);
    execFileSync("ffmpeg", args);
    for (const inp of inputs) if (!inp.startsWith("silence:")) rmSync(inp);
  }
  const duration = probe(audioAbs);
  scenes.push({ key, text: texts[i], hash, audio: audioRel, duration, characters, starts, ends });
  writeFileSync(progressFile, JSON.stringify({ id, scenes }));
  console.log(`made   ${key}  ${duration.toFixed(2)}s  ${texts[i].length} chars${pauses.length ? `  (+${pauses.reduce((a, b) => a + b, 0)}s pause)` : ""}`);
}
writeFileSync(timingFile, JSON.stringify({ id, scenes } satisfies VideoTiming));
rmSync(progressFile, { force: true });
console.log(`total narration: ${scenes.reduce((a, s) => a + s.duration, 0).toFixed(1)}s`);

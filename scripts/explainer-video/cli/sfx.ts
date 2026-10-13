// Generates the shared sound-effect set. Skips any effect already on disk.
// Usage: npx tsx cli/sfx.ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/config.js";
import { soundEffect } from "../lib/eleven.js";
import { SFX } from "../lib/sfx-library.js";

const dir = path.join(ROOT, "public/audio/sfx");
mkdirSync(dir, { recursive: true });
for (const [name, def] of Object.entries(SFX)) {
  const file = path.join(dir, `${name}.mp3`);
  if (existsSync(file)) { console.log(`skip   ${name} (already generated)`); continue; }
  writeFileSync(file, await soundEffect(def.prompt, def.seconds, def.loop));
  console.log(`made   ${name}`);
}

// The truck horn: the two honks cut from the supplied clip, tightened so the pair fits one beat of narration.
const horn = path.join(ROOT, "source/clown-horn.mp3");
const beep = path.join(dir, "beep.mp3");
if (existsSync(beep)) console.log("skip   beep (already cut)");
else if (!existsSync(horn)) console.log("MISSING source/clown-horn.mp3, so beep was not made (see README)");
else {
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", horn, "-filter_complex",
    "[0:a]atrim=0.58:1.42,asetpts=PTS-STARTPTS,afade=t=in:d=0.005,afade=t=out:st=0.78:d=0.06[a];" +
    "[0:a]atrim=1.78:2.62,asetpts=PTS-STARTPTS,afade=t=in:d=0.005,afade=t=out:st=0.78:d=0.06[b];" +
    "aevalsrc=0|0:d=0.06:s=44100[g];[a][g][b]concat=n=3:v=0:a=1[out]", "-map", "[out]", "-b:a", "128k", beep]);
  console.log("made   beep (from source/clown-horn.mp3)");
}

// Real lengths, so a cue can be fitted into a pause in the narration.
const lengths: Record<string, number> = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith(".mp3"))) {
  lengths[file.replace(/\.mp3$/, "")] = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, file)]).toString());
}
writeFileSync(path.join(dir, "durations.json"), JSON.stringify(lengths, null, 2));

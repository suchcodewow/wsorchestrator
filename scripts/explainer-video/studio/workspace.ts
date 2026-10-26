/**
 * A video job's own copy of the engine, in a temporary directory: the
 * committed scripts and shared scene code, the reference video and the shared
 * sound effects from the bucket, and whatever the video was made from last
 * time. A directory of its own because Remotion bundles every scene file in
 * `src/videos/`, and because nothing a job writes should reach the checkout.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../lib/config.js";
import { conceptsInOrder, type MapContent } from "../../../frontend/src/lib/mimir/map/schema";
import { REFERENCE_PREFIX, videoSourcePrefix } from "../../../frontend/src/lib/mimir/studio/shapes";
import { must } from "./proc.js";
import { elevenToken } from "./secrets.js";
import { contentTypeOf, download, list, remove, upload } from "./storage.js";

/** The engine as committed: copied, never edited by a job. */
const ENGINE = ["cli", "lib", "remotion.config.ts", "tsconfig.json", "package.json", "STANDARDS.md", "README.md", "src/Explainer.tsx", "src/Root.tsx", "src/index.ts", "src/ui.tsx"];

/** The level colors the scene code's `LEVELS` uses, by level. */
const LEVEL_COLORS: Record<number, string> = { 100: "green", 200: "blue", 300: "purple", 400: "amber" };

export type Workspace = {
  dir: string;
  /** The reference videos' ids: finished, approved, and there to copy. */
  references: string[];
  /** The environment the engine's scripts run with: the ElevenLabs token is passed here, never on a command line. */
  env: NodeJS.ProcessEnv;
  dispose(): void;
};

/** Every file under `dir`, as paths relative to it. */
export function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full, base) : [path.relative(base, full)];
  });
}

async function fetchPrefix(prefix: string, into: string): Promise<string[]> {
  const names = (await list(prefix)).filter((n) => !n.endsWith("/"));
  for (const name of names) {
    const rel = name.slice(prefix.length);
    const target = path.resolve(into, rel);
    if (!target.startsWith(into + path.sep)) continue;
    const body = await download(name);
    if (!body) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return names.map((n) => n.slice(prefix.length));
}

/** The course as the brief's `source/concept-data.json` gave it, worked out from the live map. */
export function conceptData(map: MapContent) {
  const ordered = conceptsInOrder(map);
  const highest: Record<number, number> = {};
  for (const c of ordered) for (const n of c.slides) highest[n] = Math.max(highest[n] ?? 0, c.level * 100);
  return {
    source_deck: map.title,
    levels: Object.fromEntries(map.levels.map((l) => [l.level * 100, l.name])),
    level_colors: Object.fromEntries(map.levels.map((l) => [l.level * 100, LEVEL_COLORS[l.level * 100]])),
    slides: map.slides.map((s) => ({ slide: s.n, title: s.title, highest_level_needed: highest[s.n] ?? null })),
    concepts: ordered.map((c) => ({
      study_order: c.study,
      id: c.id,
      name: c.name,
      level: c.level * 100,
      bucket: map.buckets.find((b) => b.id === c.bucket)?.name ?? c.bucket,
      slides: c.slides,
      explanation: c.explanation,
      ...(c.points ? { points: c.points } : {}),
    })),
  };
}

export async function makeWorkspace(map: MapContent, videoId: string, log: (text: string) => Promise<void>): Promise<Workspace & { hadSources: boolean }> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mimir-studio-"));
  for (const rel of ENGINE) cpSync(path.join(ROOT, rel), path.join(dir, rel), { recursive: true });
  mkdirSync(path.join(dir, "src/videos"), { recursive: true });
  symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");
  const env: NodeJS.ProcessEnv = { ...process.env, ELEVEN_LABS_TOKEN: elevenToken() };
  delete env.ANTHROPIC_API_KEY;
  delete env.DATABASE_URL;

  await log("Fetching the reference video and the sound effects.");
  const reference = await fetchPrefix(REFERENCE_PREFIX, dir);
  const references = [...new Set(reference.flatMap((r) => r.match(/^src\/videos\/([^/]+)\.tsx$/)?.[1] ?? []))].sort();
  if (references.length === 0) throw new Error(`There is no reference video under ${REFERENCE_PREFIX}; run studio/seed-reference.ts first.`);

  const own = await fetchPrefix(videoSourcePrefix(videoId), dir);
  const hadSources = own.some((r) => r.startsWith(`content/${videoId}/`));

  if (!existsSync(path.join(dir, "public/audio/sfx/durations.json"))) {
    await log("Making the shared sound effects, once.");
    await must("npx", ["tsx", "cli/sfx.ts"], { cwd: dir, env, timeoutMs: 15 * 60 * 1000 });
    for (const rel of walk(path.join(dir, "public/audio/sfx"))) {
      const file = `public/audio/sfx/${rel}`;
      await upload(`${REFERENCE_PREFIX}${file}`, readFileSync(path.join(dir, file)), contentTypeOf(file));
    }
  }

  mkdirSync(path.join(dir, "source"), { recursive: true });
  writeFileSync(path.join(dir, "source/concept-data.json"), JSON.stringify(conceptData(map), null, 2));
  return { dir, references, env, hadSources, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Saves what the video was made from, so the next regeneration starts from it:
 * its scripts, its scene code and its narration (which saves re-narrating the
 * scenes that do not change). Anything saved last time that is gone now goes.
 */
export async function saveSources(ws: Workspace, videoId: string): Promise<void> {
  const files = [
    ...walk(path.join(ws.dir, "content", videoId)).map((r) => `content/${videoId}/${r}`),
    `src/videos/${videoId}.tsx`,
    ...walk(path.join(ws.dir, "public/audio", videoId))
      .filter((r) => r.endsWith(".mp3") || r === "timing.json")
      .map((r) => `public/audio/${videoId}/${r}`),
  ];
  const prefix = videoSourcePrefix(videoId);
  for (const file of files) await upload(`${prefix}${file}`, readFileSync(path.join(ws.dir, file)), contentTypeOf(file));
  const keep = new Set(files.map((f) => `${prefix}${f}`));
  for (const name of await list(prefix)) if (!keep.has(name)) await remove(name);
}

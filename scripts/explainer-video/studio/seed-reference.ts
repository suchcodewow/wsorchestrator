/**
 * Puts the hand-made videos' sources in the bucket, once, so video jobs can
 * start from them: the approved reference video (its scripts and scene code)
 * with the shared sound effects and the horn clip under `REFERENCE_PREFIX`,
 * and every video's scripts, scene code and narration under its
 * `videoSourcePrefix`, so regenerating one revises it instead of starting over.
 * The files hold internal content, which is why they live in the bucket and
 * never in git.
 *
 * Usage: npx tsx studio/seed-reference.ts <explainer-video checkout> [reference id, default 01-pipelines]
 * With RECORDINGS_BUCKET (and STORAGE_EMULATOR_HOST locally) set.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REFERENCE_PREFIX, videoSourcePrefix } from "../../../frontend/src/lib/mimir/studio/shapes";
import { contentTypeOf, upload } from "./storage.js";
import { walk } from "./workspace.js";

const from = process.argv[2] && path.resolve(process.argv[2]);
const reference = process.argv[3] ?? "01-pipelines";
if (!from || !existsSync(path.join(from, "src/videos"))) {
  console.error("Usage: npx tsx studio/seed-reference.ts <explainer-video checkout> [reference id]");
  process.exit(2);
}

/** The files under `rel` in the checkout, as paths relative to the checkout, keeping only those `keep` accepts. */
const files = (rel: string, keep: (name: string) => boolean = () => true) =>
  walk(path.join(from, rel))
    .filter(keep)
    .map((r) => path.posix.join(rel, r.split(path.sep).join("/")));

async function put(prefix: string, rels: string[]): Promise<void> {
  for (const rel of rels) await upload(`${prefix}${rel}`, readFileSync(path.join(from!, rel)), contentTypeOf(rel));
  console.log(`${rels.length} files to ${prefix}`);
}

const ids = walk(path.join(from, "src/videos"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => f.replace(/\.tsx$/, ""))
  .sort();
if (!ids.includes(reference)) throw new Error(`There is no src/videos/${reference}.tsx in ${from}.`);

const horn = existsSync(path.join(from, "source/clown-horn.mp3")) ? ["source/clown-horn.mp3"] : [];
if (!horn.length) console.warn("No source/clown-horn.mp3: the horn cannot be cut until it is uploaded.");
await put(REFERENCE_PREFIX, [...files(`content/${reference}`), `src/videos/${reference}.tsx`, ...files("public/audio/sfx"), ...horn]);

for (const id of ids) {
  const audio = files(`public/audio/${id}`, (r) => r.endsWith(".mp3") || r === "timing.json");
  await put(videoSourcePrefix(id), [...files(`content/${id}`), `src/videos/${id}.tsx`, ...audio]);
}

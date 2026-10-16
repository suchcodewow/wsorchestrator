/**
 * Builds the Mimir concept-map import file, which Mimir Settings → Map loads:
 * the course (slides, concepts, groups, levels), and for each concept that has
 * one, its video and what the narrator says in it.
 *
 *   cd frontend
 *   npx tsx scripts/mimir-map-convert.ts \
 *     --concepts ~/Downloads/concept-data.json \
 *     --extras ~/Downloads/mimir-map-extras.json \
 *     --videos ~/path/to/explainer-video/out \
 *     --scripts ~/path/to/explainer-video/content \
 *     > ~/Downloads/mimir-map-content.json
 *
 * The course and the videos are not public and this repository is, so the
 * file goes wherever you put it, never in here (`.gitignore` refuses
 * `mimir-map-content*.json` as a backstop).
 *
 * `--concepts` is the concept data: slides, and each concept's id, name,
 * study order, explanation and slides. `--extras` is what that does not
 * carry: the section bands, which concepts require which, the level and group blurbs, and the groups' order.
 * `--videos` holds `<video>.mp4` and `--scripts` holds
 * `<video>/scene-*.txt`, where a video is named `NN-slug` and NN is the study
 * order of the concept it explains. A concept with no video simply has none.
 *
 * The file is checked against the same schema the importer uses before it is
 * written, so a bad one fails here, with where.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { VIDEO_PREFIX, mapContentSchema } from "../src/lib/mimir/map/schema";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > -1 ? process.argv[i + 1] : undefined;
  if (!v) {
    console.error(`Missing --${name}. See the top of scripts/mimir-map-convert.ts.`);
    process.exit(1);
  }
  return resolve(v.replace(/^~/, process.env.HOME ?? "~"));
}

type ConceptData = {
  slides: { slide: number; title: string }[];
  concepts: { id: string; name: string; study_order: number; slides: number[]; explanation: string }[];
};
type Extras = {
  title: string;
  sections: unknown[];
  levels: unknown[];
  groups: { id: string; level: number; name: string; sub?: string; blurb: string; concepts: string[] }[];
  /** Optional: by concept id, the lower-level concepts to understand first. */
  requires?: Record<string, string[]>;
};

const data = JSON.parse(readFileSync(arg("concepts"), "utf8")) as ConceptData;
const extras = JSON.parse(readFileSync(arg("extras"), "utf8")) as Extras;
const videosDir = arg("videos");
const scriptsDir = arg("scripts");

/** What is spoken, without the pauses written into the scripts. */
function transcript(video: string): string {
  const dir = join(scriptsDir, video);
  const scenes = readdirSync(dir)
    .filter((f) => /^scene-\d+-.*\.txt$/.test(f))
    .sort((a, b) => parseInt(a.split("-")[1]!) - parseInt(b.split("-")[1]!));
  return scenes
    .map((f) =>
      readFileSync(join(dir, f), "utf8")
        .split("\n")
        .filter((line) => !/^\s*\[pause [\d.]+\]\s*$/.test(line))
        .join("\n")
        .trim(),
    )
    .join("\n\n");
}

function seconds(file: string): number {
  return Math.round(parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString()) * 10) / 10;
}

const videoFor = new Map<number, string>();
for (const f of readdirSync(videosDir)) {
  const m = /^(\d+)-.+\.mp4$/.exec(f);
  if (m) videoFor.set(parseInt(m[1]!, 10), f.replace(/\.mp4$/, ""));
}

const concepts = data.concepts.map((c) => {
  const video = videoFor.get(c.study_order);
  return {
    id: c.id,
    name: c.name,
    slides: c.slides,
    explanation: c.explanation,
    ...(extras.requires?.[c.id]?.length ? { requires: extras.requires[c.id] } : {}),
    ...(video && existsSync(join(scriptsDir, video))
      ? { video: { object: `${VIDEO_PREFIX}${video}.mp4`, seconds: seconds(join(videosDir, `${video}.mp4`)), transcript: transcript(video) } }
      : {}),
  };
});

// The groups' order is the course's; it should agree with the data's own study order.
const order = extras.groups.flatMap((g) => g.concepts);
const expected = [...data.concepts].sort((a, b) => a.study_order - b.study_order).map((c) => c.id);
if (order.join() !== expected.join()) console.error("Warning: the groups' order differs from the concept data's study order. The groups win.");

const content = {
  version: 1,
  title: extras.title,
  sections: extras.sections,
  slides: data.slides.map((s) => ({ n: s.slide, title: s.title })),
  levels: extras.levels,
  buckets: extras.groups,
  concepts,
};

const parsed = mapContentSchema.safeParse(content);
if (!parsed.success) {
  const issue = parsed.error.issues[0]!;
  console.error(`Not a valid map: ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
console.error(`${concepts.length} concepts, ${concepts.filter((c) => "video" in c).length} with a video.`);
process.stdout.write(`${JSON.stringify(parsed.data)}\n`);

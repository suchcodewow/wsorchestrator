/**
 * A video job: Claude makes one concept's explainer video the way the author
 * made them by hand, following `AGENT.md`, `STANDARDS.md` and `README.md`, in
 * a workspace of its own. Its tools are the engine's scripts and a view of
 * what they produce; `finish` refuses until the video has been narrated,
 * type-checked, sound-checked, looked at scene by scene, rendered and
 * inspected since the last change to its script or scene code.
 *
 * Then the MP4 goes to the bucket under a new name, what it was made from is
 * saved for the next regeneration, and the live map points at it.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ROOT } from "../lib/config.js";
import { FPS, LEAD_SECONDS, phraseEnd, phraseStart, type VideoTiming } from "../lib/timing.js";
import { sceneFrames } from "../src/Explainer.js";
import { conceptsInOrder, SLIDE_PREFIX, type MapContent } from "../../../frontend/src/lib/mimir/map/schema";
import { videoInputSchema, videoObject, videoResultSchema, type VideoNote, type VideoResult } from "../../../frontend/src/lib/mimir/studio/shapes";
import { image, runAgent, ToolError, type AgentRun, type Tool, type ToolOutput } from "./claude.js";
import { finishVideo, liveMap, setProgress, type JobRow } from "./db.js";
import { must, run } from "./proc.js";
import { download, upload } from "./storage.js";
import { makeWorkspace, saveSources, walk, type Workspace } from "./workspace.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Turns and time for one video: the author's took an hour or two of mostly rendering. */
const MAX_TURNS = 150;
const DEADLINE_MS = 150 * 60 * 1000;
const STILLS_PER_CALL = 12;
const SLIDE_VIEWS = 30;
const READ_MAX = 200_000;
/** How often narration is retried after a rate limit, a minute apart, as the brief said to. */
const NARRATE_TRIES = 5;

/** A tool, with its input's type taken from its schema. */
const tool = <S extends z.ZodTypeAny>(t: Tool<S>): Tool => t as unknown as Tool;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tail = (s: string, n = 4000) => (s.length > n ? `…${s.slice(-n)}` : s);
const PAUSE_LINE = /^\[pause [\d.]+\]$/gm;

/** The scene files of a video, in order. */
function sceneFiles(ws: Workspace, id: string): string[] {
  const dir = path.join(ws.dir, "content", id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^scene-\d+-.*\.txt$/.test(f))
    .sort((a, b) => parseInt(a.split("-")[1]!) - parseInt(b.split("-")[1]!));
}

function readTiming(ws: Workspace, id: string): VideoTiming | null {
  const file = path.join(ws.dir, "public/audio", id, "timing.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as VideoTiming) : null;
}

/** Each scene's first frame and length, in frames, as the composition lays them out. */
function layout(timing: VideoTiming) {
  const lengths = sceneFrames(timing, FPS);
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  return { lengths, starts, total: lengths.reduce((a, b) => a + b, 0) };
}

/** The scene (from 0) a frame falls in. */
const sceneAt = (starts: number[], frame: number) => starts.reduce((at, s, i) => (s <= frame ? i : at), 0);

/** What the narrator says around `seconds` into a video, for placing a viewer's comment. */
function narrationNear(timing: VideoTiming, seconds: number): { scene: string; words: string } | null {
  const { starts } = layout(timing);
  const frame = Math.round(seconds * FPS);
  const i = sceneAt(starts, frame);
  const scene = timing.scenes[i];
  if (!scene) return null;
  const t = (frame - starts[i]!) / FPS - LEAD_SECONDS;
  const words = scene.characters.filter((_, k) => scene.starts[k]! >= t - 5 && scene.starts[k]! <= t + 2).join("").trim();
  return { scene: scene.key, words };
}

function notesBlock(notes: VideoNote[], timing: VideoTiming | null): string {
  if (notes.length === 0) return "There are no notes from viewers this time.";
  const lines = [...notes]
    .sort((a, b) => a.position - b.position)
    .map((n) => {
      const near = timing ? narrationNear(timing, n.position) : null;
      const where = near ? ` scene="${near.scene}"` : "";
      const said = near?.words ? `\n<narration_near>${escape(near.words)}</narration_near>` : "";
      return `<note at="${mmss(n.position)}" seconds="${n.position.toFixed(1)}" rating="${n.rating === "up" ? "thumbs up" : "thumbs down"}"${where}>${said}\n<comment>${escape(n.comment)}</comment>\n</note>`;
    });
  return [
    `${notes.length} accepted note${notes.length === 1 ? "" : "s"} from viewers of the previous video, each at the moment it was left${timing ? ", with what the narrator was saying then" : ""}:`,
    `<notes>\n${lines.join("\n")}\n</notes>`,
  ].join("\n");
}

export async function runVideo(job: JobRow): Promise<void> {
  const input = videoInputSchema.parse(job.input);
  const id = input.videoId;
  const progress = (text: string) => setProgress(job.id, text);
  if (!job.concept_id) throw new Error("A video job needs a concept.");
  const map = await liveMap();
  if (!map) throw new Error("There is no live map to make a video for.");
  const concept = conceptsInOrder(map).find((c) => c.id === job.concept_id);
  if (!concept) throw new Error(`The concept ${job.concept_id} is not on the live map.`);

  await progress("Setting up the workspace.");
  const ws = await makeWorkspace(map, id, progress);
  try {
    const previousTiming = readTiming(ws, id);
    const report = await makeVideo(ws, id, input.notes, previousTiming, concept, map.concepts.find((c) => c.id === concept.id)?.video?.transcript ?? null, progress);

    await progress("Uploading the video.");
    const mp4 = path.join(ws.dir, "out", `${id}.mp4`);
    const seconds = parseFloat(await must("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4], { cwd: ws.dir }));
    const version = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const object = videoObject(id, version);
    await upload(object, readFileSync(mp4), "video/mp4");
    const transcript = sceneFiles(ws, id)
      .map((f) => readFileSync(path.join(ws.dir, "content", id, f), "utf8").replace(PAUSE_LINE, "").replace(/\n{2,}/g, "\n").trim())
      .join("\n\n")
      .slice(0, 60_000);

    await progress("Saving what the video was made from.");
    await saveSources(ws, id);
    const result: VideoResult = videoResultSchema.parse({ object, seconds, report: report.slice(0, 4000) });
    await finishVideo(job.id, {
      conceptId: concept.id,
      video: { object, seconds, transcript },
      feedbackIds: input.notes.map((n) => n.feedbackId),
      result,
    });
  } finally {
    ws.dispose();
  }
}

type Concept = ReturnType<typeof conceptsInOrder<MapContent["concepts"][number]>>[number];

/**
 * The tools a video job works with, and its `finish`, over one workspace.
 * Separate from the job so they can be driven without Claude.
 */
export function videoTools(ws: Workspace, id: string, progress: (text: string) => Promise<void>): { tools: Tool[]; finish: AgentRun<string>["finish"] } {
  const content = path.join(ws.dir, "content", id);
  mkdirSync(content, { recursive: true });

  // What has been checked, by the edit it was checked at: any write moves `edit` on and so makes every check stale,
  // except narration, which hears only the scripts and so goes stale only when a script changes (`scriptEdit`).
  let edit = 0;
  let scriptEdit = 0;
  const done = { narrated: -1, typechecked: -1, sound: -1, rendered: -1, inspected: -1 };
  let stillsAt = -1;
  let seen = new Map<number, Set<number>>();
  let slideViews = 0;

  /** A path in the workspace that Claude may read; never node_modules, and never outside. */
  const readable = (rel: string): string => {
    const full = path.resolve(ws.dir, rel);
    const first = path.relative(ws.dir, full).split(path.sep)[0];
    if (!full.startsWith(ws.dir + path.sep) || first === "node_modules" || first === "..") throw new ToolError(`${rel} is outside the files you can read.`);
    if (existsSync(full) && !realpathSync(full).startsWith(realpathSync(ws.dir) + path.sep)) throw new ToolError(`${rel} is outside the files you can read.`);
    return full;
  };
  /** A path Claude may write: its own scene scripts and its own scene code, nothing else. */
  const writable = (rel: string): string => {
    const clean = path.posix.normalize(rel.replace(/^\.\//, ""));
    const sceneFile = new RegExp(`^content/${id}/scene-[1-9]-[a-z0-9-]+\\.txt$`);
    if (!sceneFile.test(clean) && clean !== `src/videos/${id}.tsx`) {
      throw new ToolError(`You can write only content/${id}/scene-<n>-<name>.txt (n from 1 to 9, the name in lowercase letters, digits and dashes) and src/videos/${id}.tsx.`);
    }
    return path.join(ws.dir, clean);
  };
  const needNarration = () => {
    if (sceneFiles(ws, id).length === 0) throw new ToolError(`There are no scene scripts in content/${id}/ yet.`);
    if (done.narrated !== scriptEdit) throw new ToolError("The scripts have changed since they were last narrated; run narrate first.");
    const timing = readTiming(ws, id);
    if (!timing) throw new ToolError("There is no narration yet; run narrate first.");
    return timing;
  };
  const needSceneCode = () => {
    if (!existsSync(path.join(ws.dir, "src/videos", `${id}.tsx`))) throw new ToolError(`There is no src/videos/${id}.tsx yet.`);
  };

  const readFile = tool({
    name: "read_file",
    description: "Reads a text file in the workspace (scripts, scene code, the shared engine, source/concept-data.json, timing.json). Paths are relative to the workspace root.",
    schema: z.object({ path: z.string().min(1) }),
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    run: async ({ path: rel }) => {
      const full = readable(rel);
      if (!existsSync(full) || statSync(full).isDirectory()) throw new ToolError(`There is no file ${rel}.`);
      if (/\.(mp3|mp4|png|jpg|wav)$/i.test(full)) throw new ToolError(`${rel} is not a text file. Use render_stills, inspect_video or view_slide to look at pictures and video.`);
      const body = readFileSync(full, "utf8");
      return body.length > READ_MAX ? `${body.slice(0, READ_MAX)}\n… (cut at ${READ_MAX} characters)` : body;
    },
  });

  const listFiles = tool({
    name: "list_files",
    description: "Lists the files under a directory of the workspace (the root when no directory is given).",
    schema: z.object({ dir: z.string().optional() }),
    inputSchema: { type: "object", properties: { dir: { type: "string" } } },
    run: async ({ dir }) => {
      const full = readable(dir || ".");
      const files = walk(full)
        .map((f) => path.relative(ws.dir, path.join(full, f)))
        .filter((f) => !f.startsWith("node_modules") && !f.startsWith("out/"));
      return files.length > 500 ? `${files.slice(0, 500).join("\n")}\n… and ${files.length - 500} more` : files.join("\n") || "(empty)";
    },
  });

  const writeFile = tool({
    name: "write_file",
    description: `Writes one of the video's own files whole: a scene script content/${id}/scene-<n>-<name>.txt or the scene code src/videos/${id}.tsx.`,
    schema: z.object({ path: z.string().min(1), content: z.string().max(100_000) }),
    inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    run: async ({ path: rel, content: body }) => {
      const full = writable(rel);
      if (rel.endsWith(".txt") && body.length > 4000) throw new ToolError("A scene's script is a few sentences; that is far too long for one.");
      const was = existsSync(full) ? readFileSync(full, "utf8") : null;
      if (was === body) return `${rel} is unchanged.`;
      writeFileSync(full, body);
      edit++;
      if (rel.endsWith(".txt")) scriptEdit++;
      return `Wrote ${rel}.`;
    },
  });

  const deleteFile = tool({
    name: "delete_file",
    description: `Deletes one of the video's own files, such as a scene script no longer wanted.`,
    schema: z.object({ path: z.string().min(1) }),
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    run: async ({ path: rel }) => {
      const full = writable(rel);
      if (!existsSync(full)) throw new ToolError(`There is no file ${rel}.`);
      unlinkSync(full);
      edit++;
      if (rel.endsWith(".txt")) scriptEdit++;
      return `Deleted ${rel}.`;
    },
  });

  const narrate = tool({
    name: "narrate",
    description: "Narrates every scene script in the cloned voice and writes public/audio/<id>/timing.json. Scenes whose text has not changed are reused, so re-running costs only the changed scenes.",
    schema: z.object({}),
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      if (sceneFiles(ws, id).length === 0) throw new ToolError(`There are no scene scripts in content/${id}/ yet.`);
      await progress("Narrating.");
      for (let attempt = 1; ; attempt++) {
        const r = await run("npx", ["tsx", "cli/narrate.ts", id], { cwd: ws.dir, env: ws.env, timeoutMs: 30 * 60 * 1000 });
        if (r.code === 0) {
          done.narrated = scriptEdit;
          return tail(r.output, 3000);
        }
        const limited = /\b429\b|rate.?limit|too many requests/i.test(r.output);
        if (!limited || attempt >= NARRATE_TRIES) throw new ToolError(`Narration failed:\n${tail(r.output)}`);
        await progress(`Narration was rate limited; trying again in a minute (${attempt} of ${NARRATE_TRIES - 1}).`);
        await new Promise((resolve) => setTimeout(resolve, 60_000));
      }
    },
  });

  const typecheck = tool({
    name: "typecheck",
    description: "Type-checks the workspace (npx tsc --noEmit -p .).",
    schema: z.object({}),
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      needSceneCode();
      const r = await run("npx", ["tsc", "--noEmit", "-p", "."], { cwd: ws.dir, env: ws.env, timeoutMs: 10 * 60 * 1000 });
      if (r.code !== 0) throw new ToolError(`Type errors:\n${tail(r.output, 6000)}`);
      done.typechecked = edit;
      return "No type errors.";
    },
  });

  const sfxReport = tool({
    name: "sfx_report",
    description: "Shows where each sound effect lands and whether any was dropped or overlaps the narration. Needs current narration.",
    schema: z.object({}),
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      needNarration();
      needSceneCode();
      const r = await run("npx", ["tsx", "cli/sfx-report.ts", id], { cwd: ws.dir, env: ws.env, timeoutMs: 5 * 60 * 1000 });
      if (r.code !== 0) throw new ToolError(`The sound check failed:\n${tail(r.output)}`);
      const m = r.output.match(/(\d+) placed, (\d+) dropped, (\d+) overlapping speech/);
      if (m && m[2] === "0" && m[3] === "0") done.sound = edit;
      return r.output.trim() + (m && (m[2] !== "0" || m[3] !== "0") ? "\n\nEvery cue has to be placed and clear of the voice before you can finish." : "");
    },
  });

  const phraseFrames = tool({
    name: "phrase_frames",
    description:
      "Each scene's first frame and length in the current narration, and, for any spoken phrases you give, the absolute frame at which each is spoken (what at() or atEnd() gives inside its scene, plus the scene's first frame). Use it to choose frames for render_stills.",
    schema: z.object({
      phrases: z
        .array(z.object({ scene: z.number().int().min(1), phrase: z.string().min(1), nth: z.number().int().min(0).optional(), end: z.boolean().optional() }))
        .max(60)
        .optional(),
    }),
    inputSchema: {
      type: "object",
      properties: {
        phrases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scene: { type: "integer", description: "The scene's number, from 1, in the order of its script files." },
              phrase: { type: "string" },
              nth: { type: "integer", description: "Which occurrence, from 0." },
              end: { type: "boolean", description: "The frame at which the phrase has been spoken, as atEnd() gives." },
            },
            required: ["scene", "phrase"],
          },
        },
      },
    },
    run: async ({ phrases }) => {
      const timing = needNarration();
      const { lengths, starts, total } = layout(timing);
      const lines = timing.scenes.map((s, i) => `scene ${i + 1} ${s.key}: frames ${starts[i]}–${starts[i]! + lengths[i]! - 1} (${lengths[i]} frames, ${s.duration.toFixed(2)}s of narration)`);
      lines.push(`total: ${total} frames, ${(total / FPS).toFixed(1)}s`);
      for (const p of phrases ?? []) {
        const scene = timing.scenes[p.scene - 1];
        if (!scene) {
          lines.push(`scene ${p.scene} "${p.phrase}": there is no scene ${p.scene}`);
          continue;
        }
        try {
          const t = p.end ? phraseEnd(scene, p.phrase, p.nth) : phraseStart(scene, p.phrase, p.nth);
          const local = Math.round((LEAD_SECONDS + t) * FPS);
          lines.push(`scene ${p.scene} "${p.phrase}"${p.end ? " (end)" : ""}: frame ${starts[p.scene - 1]! + local} (${local} into the scene)`);
        } catch (err) {
          lines.push(`scene ${p.scene} "${p.phrase}": ${(err as Error).message}`);
        }
      }
      return lines.join("\n");
    },
  });

  const renderStills = tool({
    name: "render_stills",
    description: `Renders single frames of the video as it is now and shows them to you, at most ${STILLS_PER_CALL} a call. Frames are absolute, from 0.`,
    schema: z.object({ frames: z.array(z.number().int().min(0)).min(1).max(STILLS_PER_CALL) }),
    inputSchema: {
      type: "object",
      properties: { frames: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: STILLS_PER_CALL } },
      required: ["frames"],
    },
    run: async ({ frames }) => {
      const timing = needNarration();
      needSceneCode();
      const { starts, total } = layout(timing);
      const wanted = [...new Set(frames)].sort((a, b) => a - b);
      const outside = wanted.filter((f) => f >= total);
      if (outside.length) throw new ToolError(`The video has frames 0 to ${total - 1}; ${outside.join(", ")} is past the end.`);
      await progress("Rendering stills to check.");
      const dir = path.join(ws.dir, "out/stills", id);
      rmSync(dir, { recursive: true, force: true });
      const r = await run("npx", ["tsx", "cli/render.ts", id, "--stills", wanted.join(",")], { cwd: ws.dir, env: ws.env, timeoutMs: 20 * 60 * 1000 });
      if (r.code !== 0) throw new ToolError(`Rendering the stills failed:\n${tail(r.output)}`);
      if (stillsAt !== edit) {
        stillsAt = edit;
        seen = new Map();
      }
      const out: ToolOutput = [];
      for (const frame of wanted) {
        const png = path.join(dir, `frame-${frame}.png`);
        const jpg = path.join(dir, `frame-${frame}.jpg`);
        await must("ffmpeg", ["-y", "-v", "error", "-i", png, "-vf", "scale=960:-1", "-q:v", "3", jpg], { cwd: ws.dir });
        const scene = sceneAt(starts, frame);
        if (!seen.has(scene)) seen.set(scene, new Set());
        seen.get(scene)!.add(frame);
        out.push({ type: "text", text: `Frame ${frame} (scene ${scene + 1}, ${frame - starts[scene]!} into it, ${(frame / FPS).toFixed(2)}s):` }, image(readFileSync(jpg)));
      }
      rmSync(dir, { recursive: true, force: true });
      return out;
    },
  });

  const renderVideo = tool({
    name: "render_video",
    description: "Renders the whole video to out/<id>.mp4 and brings its loudness to the standard. It takes several minutes.",
    schema: z.object({}),
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      needNarration();
      needSceneCode();
      await progress("Rendering the video.");
      const concurrency = process.env.STUDIO_RENDER_CONCURRENCY || "2";
      const r = await run("npx", ["tsx", "cli/render.ts", id, "--concurrency", concurrency], { cwd: ws.dir, env: ws.env, timeoutMs: 90 * 60 * 1000 });
      if (r.code !== 0) throw new ToolError(`The render failed:\n${tail(r.output)}`);
      done.rendered = edit;
      return `Rendered. ${r.output.match(/\d+ frames, [\d.]+s/)?.[0] ?? ""}`.trim();
    },
  });

  const inspectVideo = tool({
    name: "inspect_video",
    description: "Checks the rendered MP4: its streams and length, its loudness, and frames taken from the final file at the moments you give (in seconds).",
    schema: z.object({ at_seconds: z.array(z.number().min(0)).min(1).max(6) }),
    inputSchema: {
      type: "object",
      properties: { at_seconds: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 6, description: "Moments to take a frame from, such as a sound cue." } },
      required: ["at_seconds"],
    },
    run: async ({ at_seconds }) => {
      const mp4 = path.join(ws.dir, "out", `${id}.mp4`);
      if (done.rendered !== edit || !existsSync(mp4)) throw new ToolError("The video has changed since it was rendered; run render_video first.");
      const probe = await must(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels", "-of", "json", mp4],
        { cwd: ws.dir },
      );
      const loud = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", mp4, "-af", "ebur128=peak=true", "-f", "null", "-"], { cwd: ws.dir, timeoutMs: 10 * 60 * 1000 });
      const summary = loud.output.slice(loud.output.lastIndexOf("Summary:"));
      const seconds = (JSON.parse(probe) as { format?: { duration?: string } }).format?.duration;
      const out: ToolOutput = [{ type: "text", text: `ffprobe:\n${probe.trim()}\n\nLoudness (EBU R128):\n${summary.trim() || tail(loud.output, 1500)}` }];
      const dir = path.join(ws.dir, "out/inspect");
      mkdirSync(dir, { recursive: true });
      for (const t of at_seconds) {
        if (seconds && t >= parseFloat(seconds)) {
          out.push({ type: "text", text: `${t}s is past the end (${parseFloat(seconds).toFixed(2)}s).` });
          continue;
        }
        const jpg = path.join(dir, `at-${t}.jpg`);
        await must("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", mp4, "-frames:v", "1", "-vf", "scale=960:-1", "-q:v", "3", jpg], { cwd: ws.dir });
        out.push({ type: "text", text: `The final file at ${t}s:` }, image(readFileSync(jpg)));
      }
      rmSync(dir, { recursive: true, force: true });
      done.inspected = edit;
      return out;
    },
  });

  const viewSlide = tool({
    name: "view_slide",
    description: `Shows one slide of the deck the concept map was made from, by its number. At most ${SLIDE_VIEWS} in all.`,
    schema: z.object({ n: z.number().int().min(1) }),
    inputSchema: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
    run: async ({ n }) => {
      if (++slideViews > SLIDE_VIEWS) throw new ToolError(`You have looked at ${SLIDE_VIEWS} slides already.`);
      const body = await download(`${SLIDE_PREFIX}${n}.jpg`);
      if (!body) throw new ToolError(`There is no picture of slide ${n}.`);
      return [{ type: "text", text: `Slide ${n}:` }, image(body)];
    },
  });

  const finishSchema = z.object({ report: z.string().min(1).max(4000) });
  const finish = {
    name: "finish",
    description: "Hands in the finished video with your report. Refused until the video has been narrated, type-checked, sound-checked, looked at (two stills a scene), rendered and inspected since your last change.",
    schema: finishSchema,
    inputSchema: { type: "object" as const, properties: { report: { type: "string", description: "The report the brief asks for, under 150 words." } }, required: ["report"] },
    run: async ({ report }: z.infer<typeof finishSchema>): Promise<string> => {
      const scenes = sceneFiles(ws, id);
      const missing: string[] = [];
      if (scenes.length < 4 || scenes.length > 7) missing.push(`the video has ${scenes.length} scenes; it needs 4 to 7`);
      if (!existsSync(path.join(ws.dir, "src/videos", `${id}.tsx`))) missing.push(`there is no src/videos/${id}.tsx`);
      if (done.narrated !== scriptEdit) missing.push("narrate");
      if (done.typechecked !== edit) missing.push("a clean typecheck");
      if (done.sound !== edit) missing.push("an sfx_report with nothing dropped or overlapping");
      const timing = readTiming(ws, id);
      if (timing && done.narrated === scriptEdit) {
        const short = timing.scenes.flatMap((_, i) => ((stillsAt === edit ? seen.get(i)?.size ?? 0 : 0) >= 2 ? [] : [i + 1]));
        if (short.length) missing.push(`at least two stills of scene${short.length === 1 ? "" : "s"} ${short.join(", ")} since your last change`);
      }
      if (done.rendered !== edit) missing.push("render_video");
      if (done.inspected !== edit) missing.push("inspect_video on the final render");
      if (missing.length) throw new ToolError(`Not finished yet. Still to do since your last change: ${missing.join("; ")}.`);
      return report;
    },
  };

  return {
    tools: [readFile, listFiles, writeFile, deleteFile, narrate, typecheck, sfxReport, phraseFrames, renderStills, renderVideo, inspectVideo, viewSlide],
    finish,
  };
}

async function makeVideo(
  ws: Workspace & { hadSources: boolean },
  id: string,
  notes: VideoNote[],
  previousTiming: VideoTiming | null,
  concept: Concept,
  previousTranscript: string | null,
  progress: (text: string) => Promise<void>,
): Promise<string> {
  const { tools, finish } = videoTools(ws, id, progress);
  const system = [
    readFileSync(path.join(HERE, "AGENT.md"), "utf8"),
    `# STANDARDS.md\n\n${readFileSync(path.join(ROOT, "STANDARDS.md"), "utf8")}`,
    `# README.md\n\n${readFileSync(path.join(ROOT, "README.md"), "utf8")}`,
  ].join("\n\n---\n\n");

  const { video: _video, ...about } = concept as Concept & { video?: unknown };
  const start = ws.hadSources
    ? `This video has been made before: its scripts are in content/${id}/, its scene code in src/videos/${id}.tsx and its narration in public/audio/${id}/. Revise it; re-narrate only the scenes you change.`
    : previousTranscript
      ? `A video of this concept exists, but not what it was made from. This is what its narrator said, to start from:\n<previous_transcript>\n${escape(previousTranscript)}\n</previous_transcript>`
      : "This concept has no video yet: make its first.";
  const prompt = [
    `Make the explainer video for this concept. Its id is \`${id}\`: write content/${id}/ and src/videos/${id}.tsx.`,
    `<concept>\n${JSON.stringify({ ...about, level: about.level * 100 }, null, 2)}\n</concept>`,
    `The reference video${ws.references.length === 1 ? " is" : "s are"} ${ws.references.map((r) => `\`${r}\``).join(", ")}.${concept.slides.length ? " Its slides can be seen with view_slide." : ""}`,
    start,
    notesBlock(notes, previousTiming),
    "Work through the loop in the brief, and call finish with your report when the video is done.",
  ].join("\n\n");

  await progress(notes.length ? `Writing the script, taking in ${notes.length} note${notes.length === 1 ? "" : "s"}.` : "Writing the script.");
  return runAgent<string>({
    system,
    tools,
    prompt,
    finish,
    maxTurns: MAX_TURNS,
    deadline: Date.now() + DEADLINE_MS,
  });
}

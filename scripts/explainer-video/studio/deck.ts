/**
 * A deck job: the uploaded PPTX turned into a picture, the text and the
 * speaker notes of every slide, then Claude's draft of the concept map built
 * from them. The pictures go under the job's draft prefix and the map into the
 * job's result; nothing reaches the live map until someone publishes it.
 *
 * Two passes, so no one request carries every slide's picture: Claude first
 * describes the slides a batch at a time from their pictures, then drafts the
 * map from those descriptions, the slides' own text, and the live map, looking
 * again at any slide it needs to.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { MAP_SLIDE_LIMIT, mapContentSchema, type MapContent } from "../../../frontend/src/lib/mimir/map/schema";
import { deckObject, deckResultSchema, diffMaps, draftSlidePrefix, withLiveVideos, type DeckResult } from "../../../frontend/src/lib/mimir/studio/shapes";
import { image, runAgent, ToolError, type Tool } from "./claude.js";
import { deckReady, heartbeat, liveMap, recordAudit, setProgress, type JobRow } from "./db.js";
import { must, run } from "./proc.js";
import { download, upload } from "./storage.js";

type Slide = { n: number; picture: string; text: string; notes: string };
type Described = Slide & { title: string; description: string };

/** How many slide pictures one description request carries, and how many go at once. */
const DESCRIBE_BATCH = 8;
const DESCRIBE_PARALLEL = 3;
/** Pictures the drafting pass may look at again; its conversation keeps every one. */
const VIEW_LIMIT = 40;
/** A slide's text and notes, as far as the drafting pass is shown them. */
const TEXT_CHARS = 2500;

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

/** The words in a DrawingML part, a line per paragraph; fields such as the slide number are left out. */
function textOf(xml: string): string {
  return xml
    .replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, "")
    .split(/<\/a:p>/)
    .map((p) => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1]!)).join(""))
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** The target a relationships part gives `id`, or the first of `type`, resolved against `base`. */
function relTarget(rels: string, base: string, match: { id?: string; type?: string }): string | null {
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = m[1]!;
    const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
    const type = /\bType="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
    if (!target) continue;
    if ((match.id && id === match.id) || (match.type && type.endsWith(match.type))) return path.posix.normalize(path.posix.join(base, target));
  }
  return null;
}

/**
 * Each shown slide's speaker notes, in the deck's order. Hidden slides are
 * left out, as the PDF leaves them out. Null when the deck's parts cannot be
 * read, so notes are skipped rather than matched to the wrong slides.
 */
async function speakerNotes(pptx: string, cwd: string): Promise<string[] | null> {
  const part = async (name: string) => {
    const r = await run("unzip", ["-p", pptx, name], { cwd });
    return r.code === 0 ? r.output : null;
  };
  const presentation = await part("ppt/presentation.xml");
  const presRels = await part("ppt/_rels/presentation.xml.rels");
  if (!presentation || !presRels) return null;
  const notes: string[] = [];
  for (const m of presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    const slidePart = relTarget(presRels, "ppt", { id: m[1] });
    if (!slidePart) return null;
    const slide = await part(slidePart);
    if (!slide) return null;
    if (/<p:sld\b[^>]*\bshow="0"/.test(slide)) continue;
    const rels = await part(path.posix.join(path.posix.dirname(slidePart), "_rels", `${path.posix.basename(slidePart)}.rels`));
    const notesPart = rels ? relTarget(rels, path.posix.dirname(slidePart), { type: "/notesSlide" }) : null;
    const xml = notesPart ? await part(notesPart) : null;
    notes.push(xml ? textOf(xml) : "");
  }
  return notes;
}

/** The deck as pictures, text and notes, one entry per slide the PDF export shows. */
async function extract(pptx: string, dir: string, log: (t: string) => Promise<void>): Promise<Slide[]> {
  await log("Converting the deck to PDF.");
  // LibreOffice wants a profile it can write; a throwaway one keeps runs apart.
  const env = { ...process.env, HOME: path.join(dir, "home") };
  mkdirSync(env.HOME, { recursive: true });
  await must(process.env.SOFFICE_PATH || "soffice", ["--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, pptx], {
    cwd: dir,
    env,
    timeoutMs: 20 * 60 * 1000,
  });
  const pdf = path.join(dir, `${path.basename(pptx, ".pptx")}.pdf`);
  const info = await must("pdfinfo", [pdf], { cwd: dir });
  const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0);
  if (!pages) throw new Error("The deck converted to a PDF with no pages.");
  if (pages > MAP_SLIDE_LIMIT) throw new Error(`The deck has ${pages} slides; the map holds at most ${MAP_SLIDE_LIMIT}.`);

  await log(`Drawing ${pages} slides.`);
  const pictures = path.join(dir, "pictures");
  mkdirSync(pictures);
  await must("pdftoppm", ["-jpeg", "-jpegopt", "quality=82", "-scale-to-x", "1280", "-scale-to-y", "-1", pdf, path.join(pictures, "slide")], {
    cwd: dir,
    timeoutMs: 20 * 60 * 1000,
  });
  // pdftoppm pads the page number to the width of the last one.
  const files = readdirSync(pictures)
    .filter((f) => /^slide-\d+\.jpg$/.test(f))
    .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
  if (files.length !== pages) throw new Error(`Drew ${files.length} pictures of a ${pages}-page PDF.`);

  const notes = await speakerNotes(pptx, dir);
  if (notes && notes.length !== pages) console.log(`notes: the deck lists ${notes.length} shown slides and the PDF has ${pages}; leaving notes out`);
  const slides: Slide[] = [];
  for (let n = 1; n <= pages; n++) {
    const text = await run("pdftotext", ["-f", String(n), "-l", String(n), "-layout", pdf, "-"], { cwd: dir });
    slides.push({
      n,
      picture: path.join(pictures, files[n - 1]!),
      text: text.code === 0 ? text.output.replace(/[ \t]+\n/g, "\n").trim() : "",
      notes: notes?.length === pages ? notes[n - 1]! : "",
    });
  }
  return slides;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

const DESCRIBE_SYSTEM = `You are reviewing a sales training slide deck, a few slides at a time, so that a concept map of the course can be built from it later without the pictures.

For each slide, give a short label for it (a few words, written as a reviewer would label it, not necessarily the slide's own title) and a description of what it teaches: its claims, any diagram or flow and what it shows, products, capabilities and numbers named on it, and what the speaker notes add. Write only what is on the slide or in its notes. Do not explain beyond it or add facts of your own. A title, agenda or divider slide gets a one-line description saying so.`;

const describedSchema = z.object({
  slides: z.array(z.object({ n: z.number().int(), title: z.string().min(1).max(200), description: z.string().min(1).max(3000) })),
});

async function describe(batch: Slide[]): Promise<{ n: number; title: string; description: string }[]> {
  const content: Parameters<typeof runAgent>[0]["prompt"] = [];
  for (const s of batch) {
    content.push({ type: "text", text: `Slide ${s.n}.\n<slide_text>\n${clip(s.text, TEXT_CHARS) || "(none)"}\n</slide_text>\n<speaker_notes>\n${clip(s.notes, TEXT_CHARS) || "(none)"}\n</speaker_notes>` });
    content.push(image(readFileSync(s.picture)));
  }
  content.push({ type: "text", text: `Describe slides ${batch.map((s) => s.n).join(", ")} with describe_slides.` });
  const want = batch.map((s) => s.n);
  return runAgent({
    system: DESCRIBE_SYSTEM,
    tools: [],
    prompt: content,
    maxTurns: 4,
    deadline: Date.now() + 30 * 60 * 1000,
    finish: {
      name: "describe_slides",
      description: "Hands in the label and description of every slide in this batch, one entry per slide.",
      schema: describedSchema,
      inputSchema: {
        type: "object",
        properties: {
          slides: {
            type: "array",
            items: {
              type: "object",
              properties: {
                n: { type: "integer", description: "The slide's number." },
                title: { type: "string", description: "A short label, a few words." },
                description: { type: "string", description: "What the slide teaches, from the slide and its notes only." },
              },
              required: ["n", "title", "description"],
            },
          },
        },
        required: ["slides"],
      },
      run: async (input: z.infer<typeof describedSchema>) => {
        const got = input.slides.map((s) => s.n).sort((a, b) => a - b);
        if (got.join() !== want.join()) throw new ToolError(`Give exactly one entry for each of slides ${want.join(", ")}; got ${got.join(", ") || "none"}.`);
        return input.slides;
      },
    },
  });
}

const DRAFT_SYSTEM = `You build the concept map for a sales training course from its slide deck. Reps study the map: each concept is one idea they must be able to explain, linked to the slides that teach it, grouped into a course in study order, and placed at one of three levels:

- Level 100 (level 1): concepts everything else in the deck assumes. The general ideas a new rep needs before the product makes sense.
- Level 200 (level 2): concepts that build directly on the foundations.
- Level 300 (level 3): the technical differentiators. Capabilities that set the product apart, which only make sense once you know the stages they improve.

You are given the live map, the one reps use today, and a new version of the deck: each slide's text, speaker notes and a description of its picture. Draft the map the new deck calls for.

Rules:
- Keep what still holds. A live concept the new deck still teaches keeps its id, even if its name, slides or explanation change, so its video and every rep's progress on it carry over. Change an id only for a concept that is now a different idea.
- Add a concept for each idea the new deck teaches that the live map lacks, with a new id (lowercase letters, digits, - and _). Drop a live concept only when the new deck no longer teaches it. Concepts marked as having a video lose that video if dropped, so be sure.
- A concept's slides are every slide that teaches it or relies on it. Every slide that teaches anything belongs to at least one concept; a title, agenda or divider slide may belong to none.
- explanation: one plain-language paragraph saying what the idea is and why it matters to a customer, true to the deck. Never invent features, numbers, customers or claims. Use the deck's product names and numbers exactly as given.
- points: two to six short statements a rep must be able to put in their own words. Keep a live concept's points where they still hold; leave points out rather than guess.
- requires: only concepts at a lower level, and only where one really must be understood first. Optional.
- buckets: the groups of the course, in study order, each at one level, with a short name and a one-sentence blurb. Lower levels come first. Each concept is in exactly one group.
- levels: the three levels, kept as the live map has them unless the deck calls for different wording.
- sections: the deck's parts as runs of consecutive slides (from, to), each with a name and a band from 1 to 4, covering the deck in order.
- slides: one entry for every slide, numbered 1 to the last in order, each with a short label.
- title: the deck's name.
- Leave out every concept's video; the map keeps the live ones itself.

Look at a slide's picture with view_slide when its description leaves you unsure. When the draft is done, hand it in with submit_map, with a summary for the person who will publish it: in a few sentences, what changed from the live map and why, the concepts added, dropped and renamed, and any slide you could not place. If submit_map rejects the draft, fix what it names and submit again.`;

const mapInputSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {
    map: {
      type: "object",
      description: "The whole draft map, in the live map's format, with version 1 and no concept videos.",
      properties: {
        version: { type: "integer", enum: [1] },
        title: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: { from: { type: "integer" }, to: { type: "integer" }, name: { type: "string" }, band: { type: "integer", minimum: 1, maximum: 4 } },
            required: ["from", "to", "name", "band"],
          },
        },
        slides: {
          type: "array",
          items: { type: "object", properties: { n: { type: "integer" }, title: { type: "string" } }, required: ["n", "title"] },
        },
        levels: {
          type: "array",
          items: {
            type: "object",
            properties: { level: { type: "integer", enum: [1, 2, 3] }, name: { type: "string" }, blurb: { type: "string" } },
            required: ["level", "name", "blurb"],
          },
        },
        buckets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              level: { type: "integer", enum: [1, 2, 3] },
              name: { type: "string" },
              sub: { type: "string" },
              blurb: { type: "string" },
              concepts: { type: "array", items: { type: "string" } },
            },
            required: ["id", "level", "name", "blurb", "concepts"],
          },
        },
        concepts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              slides: { type: "array", items: { type: "integer" } },
              explanation: { type: "string" },
              points: { type: "array", items: { type: "string" } },
              requires: { type: "array", items: { type: "string" } },
            },
            required: ["id", "name", "slides", "explanation"],
          },
        },
      },
      required: ["version", "title", "sections", "slides", "levels", "buckets", "concepts"],
    },
    summary: { type: "string", description: "What changed from the live map and why, in a few sentences." },
  },
  required: ["map", "summary"],
};

const submitSchema = z.object({ map: z.record(z.unknown()), summary: z.string().min(1).max(4000) });

/** Why a draft cannot be published as it stands, or null when it can. */
export function draftProblems(map: MapContent, pages: number): string[] {
  const problems: string[] = [];
  const numbers = map.slides.map((s) => s.n);
  if (numbers.length !== pages || numbers.some((n, i) => n !== i + 1)) problems.push(`slides must be numbered 1 to ${pages}, once each, in order`);
  const levels = new Set(map.levels.map((l) => l.level));
  for (const b of map.buckets) if (!levels.has(b.level)) problems.push(`group ${b.id} is at level ${b.level}, which levels does not describe`);
  for (const s of map.sections) if (s.from > s.to || s.to > pages) problems.push(`section ${s.name} runs ${s.from}-${s.to}, outside slides 1-${pages}`);
  return problems;
}

function catalog(slides: Described[]): string {
  return slides
    .map(
      (s) =>
        `<slide n="${s.n}" label="${s.title.replace(/"/g, "'")}">\n<description>\n${s.description}\n</description>\n<slide_text>\n${clip(s.text, TEXT_CHARS) || "(none)"}\n</slide_text>\n<speaker_notes>\n${clip(s.notes, TEXT_CHARS) || "(none)"}\n</speaker_notes>\n</slide>`,
    )
    .join("\n");
}

/** The live map as the drafting pass is shown it: whether a concept has a video, not the video's transcript. */
function liveForPrompt(live: MapContent): unknown {
  return { ...live, concepts: live.concepts.map(({ video, ...c }) => ({ ...c, hasVideo: Boolean(video) })) };
}

export async function runDeck(job: JobRow): Promise<void> {
  const log = (text: string) => setProgress(job.id, text);
  const dir = mkdtempSync(path.join(os.tmpdir(), "mimir-deck-"));
  try {
    await log("Fetching the deck.");
    const body = await download(deckObject(job.id));
    if (!body) throw new Error("The uploaded deck is not in the bucket.");
    const pptx = path.join(dir, "deck.pptx");
    writeFileSync(pptx, body);

    const slides = await extract(pptx, dir, log);
    const pages = slides.length;

    await log(`Uploading ${pages} slide pictures.`);
    for (const s of slides) await upload(`${draftSlidePrefix(job.id)}${s.n}.jpg`, readFileSync(s.picture), "image/jpeg");

    const batches: Slide[][] = [];
    for (let i = 0; i < pages; i += DESCRIBE_BATCH) batches.push(slides.slice(i, i + DESCRIBE_BATCH));
    const described: Described[] = [];
    let next = 0;
    let finished = 0;
    await log(`Claude is reading the slides (0 of ${pages}).`);
    await Promise.all(
      Array.from({ length: Math.min(DESCRIBE_PARALLEL, batches.length) }, async () => {
        while (next < batches.length) {
          const batch = batches[next++]!;
          const got = await describe(batch);
          for (const d of got) described.push({ ...batch.find((s) => s.n === d.n)!, title: d.title, description: d.description });
          finished += batch.length;
          await log(`Claude is reading the slides (${finished} of ${pages}).`);
        }
      }),
    );
    described.sort((a, b) => a.n - b.n);

    const live = await liveMap();
    await log("Claude is drafting the concept map.");
    let views = 0;
    const viewSlide: Tool<z.ZodObject<{ n: z.ZodNumber }>> = {
      name: "view_slide",
      description: `Shows the picture of one slide of the new deck. At most ${VIEW_LIMIT} in all.`,
      schema: z.object({ n: z.number().int() }),
      inputSchema: { type: "object", properties: { n: { type: "integer", description: "The slide's number." } }, required: ["n"] },
      run: async ({ n }) => {
        const s = slides.find((x) => x.n === n);
        if (!s) throw new ToolError(`There is no slide ${n}; the deck has 1 to ${pages}.`);
        if (++views > VIEW_LIMIT) throw new ToolError(`You have looked at ${VIEW_LIMIT} slides already; work from the descriptions.`);
        return [{ type: "text", text: `Slide ${n}:` }, image(readFileSync(s.picture))];
      },
    };

    const prompt = [
      live
        ? `<live_map>\n${JSON.stringify(liveForPrompt(live))}\n</live_map>`
        : "There is no live map yet: draft the first one.",
      `The new deck has ${pages} slides.\n<new_deck>\n${catalog(described)}\n</new_deck>`,
      "Draft the map for the new deck and hand it in with submit_map.",
    ].join("\n\n");

    const result = await runAgent<DeckResult>({
      system: DRAFT_SYSTEM,
      tools: [viewSlide as Tool],
      prompt,
      maxTurns: 60,
      deadline: Date.now() + 90 * 60 * 1000,
      onTurn: () => heartbeat(job.id),
      finish: {
        name: "submit_map",
        description: "Hands in the draft map and the summary of what changed. Rejected with the reasons if the map does not hold together.",
        schema: submitSchema,
        inputSchema: mapInputSchema,
        run: async (input: z.infer<typeof submitSchema>) => {
          const concepts = Array.isArray(input.map.concepts) ? input.map.concepts.map((c) => (c && typeof c === "object" ? { ...c, video: undefined } : c)) : input.map.concepts;
          const parsed = mapContentSchema.safeParse({ ...input.map, concepts });
          if (!parsed.success) {
            const issues = parsed.error.issues.slice(0, 30).map((i) => `${i.path.join(".") || "map"}: ${i.message}`);
            throw new ToolError(`The draft does not hold together:\n${issues.join("\n")}`);
          }
          const problems = draftProblems(parsed.data, pages);
          if (problems.length) throw new ToolError(`The draft does not fit the deck:\n${problems.join("\n")}`);
          return deckResultSchema.parse({ draft: withLiveVideos(parsed.data, live), slides: pages, summary: input.summary });
        },
      },
    });

    await deckReady(job.id, result);
    const diff = diffMaps(live, result.draft);
    await recordAudit("studio.deck.ready", `Drafted a concept map from ${job.label}.`, job.id, job.label, "succeeded", {
      slides: pages,
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

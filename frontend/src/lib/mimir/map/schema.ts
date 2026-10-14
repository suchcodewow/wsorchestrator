/**
 * The concept map's content, and what is worked out from it: the order the
 * concepts are studied in, the level each belongs to, and the highest level
 * each slide needs. Pure, so the importer, the routes, the coach and the page
 * share one reading of it.
 *
 * The content is imported (Mimir Settings → Map), never committed: the
 * repository is public and the course is not. Nothing here names a concept.
 */

import { z } from "zod";

export const MAP_ID = "current";
/** The most any one list the map holds may run to, so no query reads more than a page of rows. */
export const MAP_CONCEPT_LIMIT = 100;
export const MAP_SLIDE_LIMIT = 200;
/** A video object lives under this prefix in the recordings bucket, clear of the prefixes its lifecycle rules delete. */
export const VIDEO_PREFIX = "mimir/videos/";

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "lowercase letters, digits, - and _");
const text = (max: number) => z.string().trim().max(max);

export const levelNumber = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type MapLevel = z.infer<typeof levelNumber>;

const videoSchema = z.object({
  /** Where the file is in the recordings bucket. */
  object: z.string().startsWith(VIDEO_PREFIX).max(200).regex(/^[A-Za-z0-9._/-]+$/, "letters, digits and . _ / -"),
  /** Its length, from the file. The player reports the real one; this sizes the ring before it has played. */
  seconds: z.number().positive().max(6 * 3600),
  /** What the narrator says: the coach reads it to know the video. */
  transcript: text(60_000),
});
export type MapVideo = z.infer<typeof videoSchema>;

const conceptSchema = z.object({
  id,
  name: text(120).min(1),
  slides: z.array(z.number().int().min(1).max(MAP_SLIDE_LIMIT)).max(MAP_SLIDE_LIMIT),
  /** One plain-language paragraph. */
  explanation: text(4000).min(1),
  video: videoSchema.optional(),
});
export type MapConceptInput = z.infer<typeof conceptSchema>;

export const mapContentSchema = z
  .object({
    version: z.literal(1),
    title: text(200).min(1),
    sections: z
      .array(z.object({ from: z.number().int().min(1), to: z.number().int().min(1), name: text(80).min(1), band: z.number().int().min(1).max(4) }))
      .max(12),
    slides: z.array(z.object({ n: z.number().int().min(1).max(MAP_SLIDE_LIMIT), title: text(200).min(1) })).min(1).max(MAP_SLIDE_LIMIT),
    levels: z.array(z.object({ level: levelNumber, name: text(80).min(1), blurb: text(400) })).max(3),
    /** In course order. A group may be split in two (a `sub` each) and keep one id. */
    buckets: z
      .array(z.object({ id, level: levelNumber, name: text(120).min(1), sub: text(80).optional(), blurb: text(400), concepts: z.array(id).min(1) }))
      .min(1)
      .max(40),
    concepts: z.array(conceptSchema).min(1).max(MAP_CONCEPT_LIMIT),
  })
  .superRefine((c, ctx) => {
    const fail = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: "custom", message, path });
    const conceptIds = new Set<string>();
    c.concepts.forEach((k, i) => {
      if (conceptIds.has(k.id)) fail(`duplicate concept ${k.id}`, ["concepts", i, "id"]);
      conceptIds.add(k.id);
    });
    const placed = new Set<string>();
    c.buckets.forEach((b, i) =>
      b.concepts.forEach((cid, j) => {
        if (!conceptIds.has(cid)) fail(`unknown concept ${cid}`, ["buckets", i, "concepts", j]);
        if (placed.has(cid)) fail(`${cid} is in two groups`, ["buckets", i, "concepts", j]);
        placed.add(cid);
      }),
    );
    for (const cid of conceptIds) if (!placed.has(cid)) fail(`${cid} is in no group`, ["buckets"]);
    const slideNumbers = new Set(c.slides.map((s) => s.n));
    c.concepts.forEach((k, i) =>
      k.slides.forEach((n, j) => {
        if (!slideNumbers.has(n)) fail(`slide ${n} does not exist`, ["concepts", i, "slides", j]);
      }),
    );
    const objects = new Set<string>();
    c.concepts.forEach((k, i) => {
      if (!k.video) return;
      if (objects.has(k.video.object)) fail(`two videos at ${k.video.object}`, ["concepts", i, "video", "object"]);
      objects.add(k.video.object);
    });
  });

export type MapContent = z.infer<typeof mapContentSchema>;

/** A concept with where it falls in the course. */
export type InOrder<C> = C & {
  /** Position in the course, from 1. */
  study: number;
  level: MapLevel;
  /** The group it sits in. */
  bucket: string;
};
export type MapConcept = InOrder<MapConceptInput>;

/** The concepts in the order they are studied, each with its level and group. */
export function conceptsInOrder<C extends { id: string }>(content: { buckets: MapContent["buckets"]; concepts: C[] }): InOrder<C>[] {
  const byId = new Map(content.concepts.map((c) => [c.id, c]));
  const out: InOrder<C>[] = [];
  for (const b of content.buckets) {
    for (const cid of b.concepts) {
      const c = byId.get(cid);
      if (c) out.push({ ...c, study: out.length + 1, level: b.level, bucket: b.id });
    }
  }
  return out;
}

/** The highest level each slide needs, by slide number; a slide no concept uses has no entry. */
export function slideLevels(concepts: { level: MapLevel; slides: number[] }[]): Record<number, MapLevel> {
  const need: Record<number, MapLevel> = {};
  for (const c of concepts) for (const n of c.slides) if (!need[n] || c.level > need[n]!) need[n] = c.level;
  return need;
}

/** How far through its video a concept's ring is drawn, from 0 to 1. */
export function ringFraction(progress: { completed: boolean; videoFurthest: number; videoDuration: number }, fallbackSeconds: number): number {
  if (progress.completed) return 1;
  const total = progress.videoDuration > 0 ? progress.videoDuration : fallbackSeconds;
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, progress.videoFurthest / total));
}

/** The seconds from the end within which a video counts as finished, and so starts over. */
export const END_SLACK_SECONDS = 3;
/** The share of the video that counts as watched to the end. */
export const COMPLETE_SHARE = 0.95;

/** Where a video starts playing: where they left off, or the beginning if they were at the end or never started. */
export function startAt(position: number, duration: number): number {
  if (!(position > 0) || !(duration > 0)) return 0;
  return position >= duration - END_SLACK_SECONDS ? 0 : position;
}

/** One person's standing on one concept, as the page reads it. */
export type ConceptState = {
  /** Where they left off, and the furthest they have been, in seconds. */
  videoSeconds: number;
  videoFurthest: number;
  videoDuration: number;
  /** They have watched to the end at least once. */
  completed: boolean;
  /** The coach is satisfied they know the main points. */
  mastered: boolean;
  /** The coach has asked them to watch the video, and they have not yet shown they know it. */
  recommended: boolean;
  /** Where playing starts if they press play now. */
  resumeAt: number;
};

export const NO_STATE: ConceptState = {
  videoSeconds: 0,
  videoFurthest: 0,
  videoDuration: 0,
  completed: false,
  mastered: false,
  recommended: false,
  resumeAt: 0,
};

/**
 * The map as the page gets it: everything but what a video is called in the
 * bucket and what the narrator says, which only the server and the coach need.
 */
export type PublicMap = Omit<MapContent, "concepts"> & { concepts: (Omit<MapConceptInput, "video"> & { video?: { seconds: number } })[] };

export function publicMap(content: MapContent): PublicMap {
  return { ...content, concepts: content.concepts.map(({ video, ...c }) => (video ? { ...c, video: { seconds: video.seconds } } : c)) };
}

/** What `GET /api/mimir/map` answers. */
export type MapResponse = {
  /** Null until a Training Administrator imports one. */
  map: PublicMap | null;
  importedAt: string | null;
  /** By concept id; a concept with no entry has none of it. */
  states: Record<string, ConceptState>;
  /** Whether this deployment can play videos at all. */
  videos: boolean;
};

/**
 * What a Mimir Studio job is given and what it hands back, shared by the app
 * and the studio job (`scripts/explainer-video/studio/`), which imports this
 * file directly. Pure and free of `@/` imports for that reason.
 *
 * A deck job turns an uploaded slide deck into a draft of the concept map: the
 * slides' pictures under `draftSlidePrefix(jobId)`, and the map itself in the
 * job's result. Publishing copies both over the live ones. A video job writes
 * one concept's explainer video, taking in the accepted comments on the one
 * before it, and adds it to the live map itself.
 */

import { z } from "zod";
import { MAP_SLIDE_LIMIT, VIDEO_PREFIX, mapContentSchema, type MapContent } from "../map/schema";

/** Everything the studio keeps sits under this prefix in the recordings bucket. */
export const STUDIO_PREFIX = "mimir/studio/";
/** The uploaded deck, until the job that read it is published or discarded. */
export const deckObject = (jobId: string) => `${STUDIO_PREFIX}uploads/${jobId}.pptx`;
/** A draft's slide pictures, `<n>.jpg` under this, as `SLIDE_PREFIX` holds the live ones. */
export const draftSlidePrefix = (jobId: string) => `${STUDIO_PREFIX}drafts/${jobId}/slides/`;
/** What a video was made from (its script, scenes and narration), so the next regeneration starts from it. */
export const videoSourcePrefix = (videoId: string) => `${STUDIO_PREFIX}videos/${videoId}/`;
/** The reference video and the shared sound effects every video job starts with. Private, so uploaded, never committed. */
export const REFERENCE_PREFIX = `${STUDIO_PREFIX}reference/`;

/** A deck as large as anyone sends; the picture of every slide is what takes the time. */
export const DECK_MAX_BYTES = 200 * 1024 * 1024;
export const DECK_FILE_NAME_MAX = 200;
/** Notes from comments: as many as the job's prompt has room for with the video's own script. */
export const VIDEO_NOTES_MAX = 100;
export const VIDEO_NOTE_CHARS = 2000;

/** `NN-slug`: words of lowercase letters and digits joined by single dashes, so a `--` can only be a version's. */
const VIDEO_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Where a regenerated video goes: a new object each time, so a page still playing the last one is not cut off. */
export const videoObject = (videoId: string, version: string) => `${VIDEO_PREFIX}${videoId}--${version}.mp4`;

/** The `NN-slug` a video's object is filed under, with any version taken off; null for a name that is not one. */
export function videoIdOf(object: string): string | null {
  if (!object.startsWith(VIDEO_PREFIX) || !object.endsWith(".mp4")) return null;
  const id = object.slice(VIDEO_PREFIX.length, -".mp4".length).split("--")[0]!;
  return VIDEO_ID.test(id) && id.length <= 64 ? id : null;
}

export const deckInputSchema = z.object({
  fileName: z.string().min(1).max(DECK_FILE_NAME_MAX),
  bytes: z.number().int().positive().max(DECK_MAX_BYTES),
});
export type DeckInput = z.infer<typeof deckInputSchema>;

export const deckResultSchema = z.object({
  /** The map as it would be published, the live concepts' ids kept wherever they still fit. */
  draft: mapContentSchema,
  slides: z.number().int().min(1).max(MAP_SLIDE_LIMIT),
  /** Claude's account of what changed and why, in a few sentences. */
  summary: z.string().max(4000),
});
export type DeckResult = z.infer<typeof deckResultSchema>;

/** One accepted comment, as the video job is told it. */
export const videoNoteSchema = z.object({
  feedbackId: z.string(),
  /** Seconds into the video the comment was made at. */
  position: z.number().min(0),
  rating: z.enum(["up", "down"]),
  comment: z.string().max(VIDEO_NOTE_CHARS),
});
export type VideoNote = z.infer<typeof videoNoteSchema>;

export const videoInputSchema = z.object({
  /** The `NN-slug` name its files go by: the current video's, or one made from the concept for a first video. */
  videoId: z.string().max(64).regex(VIDEO_ID),
  /** The video's object in the bucket when the job was asked for, if it had one. */
  previous: z.string().nullable(),
  notes: z.array(videoNoteSchema).max(VIDEO_NOTES_MAX),
});
export type VideoInput = z.infer<typeof videoInputSchema>;

export const videoResultSchema = z.object({
  object: z.string(),
  seconds: z.number().positive(),
  /** Claude's report on the video, as the brief asks for one: under 150 words. */
  report: z.string().max(4000),
});
export type VideoResult = z.infer<typeof videoResultSchema>;

export type MapDiff = {
  added: { id: string; name: string; level: number }[];
  removed: { id: string; name: string; hadVideo: boolean }[];
  changed: { id: string; name: string; was: string | null; what: string[] }[];
  unchanged: number;
  slides: { was: number; now: number };
};

const levelsOf = (m: MapContent) => new Map(m.buckets.flatMap((b) => b.concepts.map((id) => [id, b.level] as const)));
const sameList = (a: readonly unknown[] = [], b: readonly unknown[] = []) => a.length === b.length && a.every((x, i) => x === b[i]);

/** What publishing `draft` would change in `live`, concept by concept. */
export function diffMaps(live: MapContent | null, draft: MapContent): MapDiff {
  const before = new Map((live?.concepts ?? []).map((c) => [c.id, c]));
  const after = new Map(draft.concepts.map((c) => [c.id, c]));
  const levelBefore = live ? levelsOf(live) : new Map<string, number>();
  const levelAfter = levelsOf(draft);
  const diff: MapDiff = { added: [], removed: [], changed: [], unchanged: 0, slides: { was: live?.slides.length ?? 0, now: draft.slides.length } };
  for (const c of draft.concepts) {
    const was = before.get(c.id);
    if (!was) {
      diff.added.push({ id: c.id, name: c.name, level: levelAfter.get(c.id) ?? 0 });
      continue;
    }
    const what: string[] = [];
    if (was.name !== c.name) what.push("name");
    if (levelBefore.get(c.id) !== levelAfter.get(c.id)) what.push("level");
    if (!sameList(was.slides, c.slides)) what.push("slides");
    if (was.explanation !== c.explanation) what.push("explanation");
    if (!sameList(was.points, c.points)) what.push("points");
    if (!sameList(was.requires, c.requires)) what.push("requires");
    if (what.length) diff.changed.push({ id: c.id, name: c.name, was: was.name !== c.name ? was.name : null, what });
    else diff.unchanged++;
  }
  for (const c of live?.concepts ?? []) if (!after.has(c.id)) diff.removed.push({ id: c.id, name: c.name, hadVideo: Boolean(c.video) });
  return diff;
}

/** The draft with each kept concept's video as it is in `live` now, which may be newer than when the draft was made. */
export function withLiveVideos(draft: MapContent, live: MapContent | null): MapContent {
  const videos = new Map((live?.concepts ?? []).flatMap((c) => (c.video ? [[c.id, c.video] as const] : [])));
  return {
    ...draft,
    concepts: draft.concepts.map((c) => {
      const v = videos.get(c.id);
      const kept = { ...c, video: v };
      if (!v) delete kept.video;
      return kept;
    }),
  };
}

/**
 * The `NN-slug` a concept's first video is filed under: the number after the
 * highest any video on `map` has, then the concept's id.
 */
export function newVideoId(map: MapContent, conceptId: string): string {
  const numbers = map.concepts.map((c) => (c.video ? Number(videoIdOf(c.video.object)?.match(/^(\d+)-/)?.[1] ?? 0) : 0));
  const next = Math.max(0, ...numbers) + 1;
  const slug = conceptId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "concept";
  return `${String(next).padStart(2, "0")}-${slug}`.slice(0, 64).replace(/-+$/, "");
}

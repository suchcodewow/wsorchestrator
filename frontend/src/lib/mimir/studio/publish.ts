/**
 * Publishing a deck job's draft: its slide pictures over the live ones, then
 * its map over the live map, each kept concept keeping the video it has now.
 * Discarding one throws the draft away. Either way the uploaded deck goes.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mimirMap } from "@/db/schema";
import { compose, deleteObject, listObjects } from "@/lib/recording/gcs";
import { mapContentSchema, MAP_ID, type MapContent } from "../map/schema";
import { slideObject } from "../map/slides";
import { bucket } from "../map/video";
import { getJob, moveJob, type StudioJob } from "./jobs";
import { deckObject, deckResultSchema, diffMaps, draftSlidePrefix, withLiveVideos, type DeckResult, type MapDiff } from "./shapes";

/** A deck job's draft, if it has a usable one. */
export function draftOf(job: StudioJob): DeckResult | null {
  if (job.kind !== "deck" || !job.result) return null;
  const parsed = deckResultSchema.safeParse(job.result);
  return parsed.success ? parsed.data : null;
}

/** Deletes everything under `prefix` but what `keep` names; a failure is logged, not raised, as nothing depends on it. */
async function sweep(b: string, prefix: string, keep: (name: string) => boolean = () => false): Promise<number> {
  try {
    const found = await listObjects(b, prefix);
    const doomed = found.map((o) => o.name).filter((n) => !keep(n));
    await Promise.all(doomed.map((n) => deleteObject(b, n)));
    return doomed.length;
  } catch (err) {
    console.error(`mimir studio: could not tidy ${prefix}`, err);
    return 0;
  }
}

export type PublishOutcome =
  | { ok: true; job: StudioJob; diff: MapDiff }
  | { ok: false; error: "not_found" | "not_ready" | "not_configured" | "invalid" };

export async function publishDeck(userId: string, jobId: string): Promise<PublishOutcome> {
  const job = await getJob(jobId);
  if (!job || job.kind !== "deck") return { ok: false, error: "not_found" };
  if (job.status !== "ready") return { ok: false, error: "not_ready" };
  const draft = draftOf(job);
  if (!draft) return { ok: false, error: "invalid" };
  const b = bucket();
  if (!b) return { ok: false, error: "not_configured" };

  // Pictures first: copying is safe to repeat, and a map naming a slide with
  // no picture would show it blank until the copy caught up.
  const from = draftSlidePrefix(job.id);
  const numbers = draft.draft.slides.map((s) => s.n);
  for (const n of numbers) await compose(b, [`${from}${n}.jpg`], slideObject(n), "image/jpeg");

  const claimed = await moveJob(job.id, "deck", "ready", "published", { finishedAt: new Date() });
  if (!claimed) return { ok: false, error: "not_ready" };

  const diff = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(mimirMap).where(eq(mimirMap.id, MAP_ID)).for("update");
    const parsed = row ? mapContentSchema.safeParse(row.content) : null;
    const live: MapContent | null = parsed?.success ? parsed.data : null;
    const content = withLiveVideos(draft.draft, live);
    const now = new Date();
    await tx
      .insert(mimirMap)
      .values({ id: MAP_ID, content, importedBy: userId, importedAt: now })
      .onConflictDoUpdate({ target: mimirMap.id, set: { content, importedBy: userId, importedAt: now } });
    return diffMaps(live, content);
  });

  const keep = new Set(numbers.map(slideObject));
  await sweep(b, "mimir/slides/", (n) => keep.has(n));
  await sweep(b, from);
  await sweep(b, deckObject(job.id));
  return { ok: true, job: claimed, diff };
}

export async function discardDeck(jobId: string): Promise<{ ok: true; job: StudioJob } | { ok: false; error: "not_found" | "not_ready" }> {
  const job = await getJob(jobId);
  if (!job || job.kind !== "deck") return { ok: false, error: "not_found" };
  const claimed =
    (await moveJob(job.id, "deck", "ready", "discarded", { finishedAt: new Date() })) ??
    (await moveJob(job.id, "deck", "failed", "discarded")) ??
    (await moveJob(job.id, "deck", "uploading", "discarded", { finishedAt: new Date() }));
  if (!claimed) return { ok: false, error: "not_ready" };
  const b = bucket();
  if (b) {
    await sweep(b, draftSlidePrefix(job.id));
    await sweep(b, deckObject(job.id));
  }
  return { ok: true, job: claimed };
}

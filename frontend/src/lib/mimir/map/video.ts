/**
 * A concept's video: a private object in the recordings bucket, played from a
 * short-lived signed URL so the file goes from Cloud Storage to the browser
 * and never through the app, and seeking works. The app's own credentials sign
 * the URL; it has no key on Cloud Run, so `lib/recording/gcs.ts` signs through
 * IAM as it does for recordings.
 */

import "server-only";

import { objectSize, signedUrl } from "@/lib/recording/gcs";

/** Long enough to watch a video through, then a fresh one is asked for. */
const VIDEO_URL_SECONDS = 3 * 60 * 60;

export const bucket = () => process.env.RECORDINGS_BUCKET || null;

/** Whether this deployment has somewhere to keep videos. Local disk mode has none. */
export const videosConfigured = () => Boolean(bucket());

export type VideoUrl = { ok: true; url: string; expiresInSeconds: number } | { ok: false; error: "not_configured" | "missing" };

/** A signed URL for the video at `object`, or why there is none. */
export async function signedVideoUrl(object: string): Promise<VideoUrl> {
  const b = bucket();
  if (!b) return { ok: false, error: "not_configured" };
  if ((await objectSize(b, object)) === null) return { ok: false, error: "missing" };
  return { ok: true, url: await signedUrl({ method: "GET", bucket: b, object, expiresSeconds: VIDEO_URL_SECONDS }), expiresInSeconds: VIDEO_URL_SECONDS };
}

/** Whether each of these videos is in the bucket: true or false, or null for all when this deployment has none. */
export async function videosPresent(objects: string[]): Promise<Record<string, boolean> | null> {
  const b = bucket();
  if (!b) return null;
  const present = await Promise.all(objects.map(async (o) => (await objectSize(b, o)) !== null));
  return Object.fromEntries(objects.map((o, i) => [o, present[i]!]));
}

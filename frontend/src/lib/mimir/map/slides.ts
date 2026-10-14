/**
 * A slide's picture for the map's hover preview: a private JPEG in the
 * recordings bucket at `mimir/slides/<n>.jpg`, shown from a short-lived signed
 * URL like a concept's video. The pictures are the course's and this
 * repository is public, so they are uploaded (`scripts/mimir-upload-slides.sh`),
 * never committed. A slide without one simply has no preview.
 */

import "server-only";

import { listObjects, objectSize, signedUrl } from "@/lib/recording/gcs";
import { bucket } from "./video";
import { MAP_SLIDE_LIMIT, SLIDE_PREFIX } from "./schema";

/** The page asks for the picture again after this long, well inside the signed link's life. */
export const SLIDE_CACHE_SECONDS = 50 * 60;
const SLIDE_URL_SECONDS = 60 * 60;

/** The bucket object for slide `n`. */
export const slideObject = (n: number) => `${SLIDE_PREFIX}${n}.jpg`;

/** A slide number from a URL segment, or null when it is not a whole number in range. */
export function parseSlideNumber(raw: string): number | null {
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= MAP_SLIDE_LIMIT ? n : null;
}

/** The slide numbers that have a picture in this environment's bucket, or null when it has no bucket. One listing, not a call per slide. */
export async function slidesPresent(): Promise<number[] | null> {
  const b = bucket();
  if (!b) return null;
  const found = await listObjects(b, SLIDE_PREFIX);
  const numbers: number[] = [];
  for (const o of found) {
    const m = /^(\d+)\.jpg$/.exec(o.name.slice(SLIDE_PREFIX.length));
    const n = m ? parseSlideNumber(m[1]!) : null;
    if (n !== null) numbers.push(n);
  }
  return numbers.sort((a, b2) => a - b2);
}

export type SlideUrl =
  | { ok: true; url: string }
  | { ok: false; error: "not_configured" | "missing" };

/** A signed URL for slide `n`'s picture, or why there is none. */
export async function signedSlideUrl(n: number): Promise<SlideUrl> {
  const b = bucket();
  if (!b) return { ok: false, error: "not_configured" };
  if ((await objectSize(b, slideObject(n))) === null)
    return { ok: false, error: "missing" };
  return {
    ok: true,
    url: await signedUrl({
      method: "GET",
      bucket: b,
      object: slideObject(n),
      expiresSeconds: SLIDE_URL_SECONDS,
    }),
  };
}

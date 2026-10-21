/**
 * The round, ringed photos on the thank-you slide. Slides cannot crop a
 * picture to a circle through its API, so each photo is drawn here and Google
 * fetches it from a signed link on this app (`photo/route.ts`). The link
 * carries the Slack image and the ring colour, and is only good for a while.
 */

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import sharp from "sharp";

export type Ring = "blue" | "orange";

const RING_COLOR: Record<Ring, string> = { blue: "#7DD3FC", orange: "#F97316" };
const SIZE = 256;
const BORDER = 10;
/** Long enough for Slides to fetch every photo of a deck. */
const LINK_TTL_MS = 15 * 60_000;
const SLACK_HOST = /(^|\.)(slack-edge\.com|slack\.com|gravatar\.com)$/;

function secret(): string {
  const key = process.env.HARNESS_TOKEN_ENC_KEY || process.env.AUTH_SECRET;
  if (!key) throw new Error("Cannot sign photo links: set HARNESS_TOKEN_ENC_KEY or AUTH_SECRET.");
  return key;
}

function sign(src: string, ring: Ring, exp: number): string {
  return createHmac("sha256", secret()).update(`${src}|${ring}|${exp}`).digest("base64url");
}

/** The link Google Slides fetches for `src` drawn round with a `ring` border. */
export function photoLink(origin: string, src: string, ring: Ring): string {
  const exp = Date.now() + LINK_TTL_MS;
  const q = new URLSearchParams({ src, ring, exp: String(exp), sig: sign(src, ring, exp) });
  return `${origin.replace(/\/+$/, "")}/api/logistics/guest-judges/thank-you/photo?${q}`;
}

/** The Slack image and ring a link asks for, or null where it is forged, expired or points off Slack. */
export function verifyPhotoLink(params: URLSearchParams): { src: string; ring: Ring } | null {
  const src = params.get("src") ?? "";
  const ring = params.get("ring");
  const exp = Number(params.get("exp"));
  const sig = params.get("sig") ?? "";
  if (ring !== "blue" && ring !== "orange") return null;
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const want = Buffer.from(sign(src, ring, exp));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const url = new URL(src);
    if (url.protocol !== "https:" || !SLACK_HOST.test(url.hostname)) return null;
  } catch {
    return null;
  }
  return { src, ring };
}

/** `image` cropped to a circle with a ring around it, as a PNG. */
export async function roundPhoto(image: Buffer, ring: Ring): Promise<Buffer> {
  const r = SIZE / 2;
  const mask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`);
  const stroke = Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}"><circle cx="${r}" cy="${r}" r="${r - BORDER / 2}" fill="none" stroke="${RING_COLOR[ring]}" stroke-width="${BORDER}"/></svg>`,
  );
  return sharp(image)
    .resize(SIZE, SIZE, { fit: "cover" })
    .composite([{ input: mask, blend: "dest-in" }, { input: stroke }])
    .png()
    .toBuffer();
}

/**
 * Reading a presentation's deck from Google Slides, as the Google account
 * connected under Admin Settings → External Connectors: the deck's slides in
 * one `presentations.get`, and a picture of one slide at a time.
 */

import "server-only";

import sharp from "sharp";
import { PRESENTATION_LIMITS } from "@/db/schema";
import { GoogleError, type CalendarClient } from "@/lib/google-calendar";
import { googleSlidesConnection, openSlidesClients, revoked, type GoogleSlidesFailure } from "@/lib/google-slides-access";
import { DECK_FIELDS, readDeckJson, type ApiPresentation, type Deck } from "./deck";

export type DeckFailure = GoogleSlidesFailure | { ok: false; error: "google_cannot_open" | "too_many_slides" | "failed"; message: string };

/** Google's widest picture of a slide. */
const IMAGE_SIZE = "WIDTH2000_PX";
const IMAGE_QUALITY = 90;
/** Google allows 60 slide pictures a minute per account; one every 1.1s stays under it on one server. */
const IMAGE_GAP_MS = 1_100;
/** An access token lasts an hour; one is kept for less than that. */
const TOKEN_MS = 45 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let clients: { key: string; until: number; slides: CalendarClient; email: string } | null = null;

/** `run` with the Slides client for the connected account, its failures as a `DeckFailure`. */
async function withSlides<T>(run: (slides: CalendarClient, email: string) => Promise<T>): Promise<{ ok: true; value: T } | DeckFailure> {
  const google = await googleSlidesConnection();
  if (!google.ok) return google;
  const { client, connection } = google;
  const key = `${connection.email} ${connection.connectedAt.toISOString()}`;
  try {
    if (!clients || clients.key !== key || clients.until < Date.now()) {
      const opened = await openSlidesClients(client, connection);
      if (!opened.ok) return opened;
      clients = { key, until: Date.now() + TOKEN_MS, slides: opened.slides, email: connection.email };
    }
    return { ok: true, value: await run(clients.slides, clients.email) };
  } catch (err) {
    if (err instanceof GoogleError) {
      if (err.revoked) {
        clients = null;
        return revoked(connection);
      }
      if (err.status === 400 || err.status === 403 || err.status === 404) {
        return {
          ok: false,
          error: "google_cannot_open",
          message: `${connection.email} cannot open that deck. Check the link, or share the deck with ${connection.email}.`,
        };
      }
    }
    return { ok: false, error: "failed", message: (err as Error).message };
  }
}

/** The deck's title and every slide, in order. */
export async function readDeck(fileId: string): Promise<{ ok: true; deck: Deck } | DeckFailure> {
  const read = await withSlides((slides) =>
    slides.call<ApiPresentation>("GET", `/presentations/${encodeURIComponent(fileId)}`, { query: { fields: DECK_FIELDS } }),
  );
  if (!read.ok) return read;
  const deck = readDeckJson(read.value);
  if (deck.slides.length > PRESENTATION_LIMITS.slides) {
    return {
      ok: false,
      error: "too_many_slides",
      message: `That deck has ${deck.slides.length} slides; at most ${PRESENTATION_LIMITS.slides} can be presented here.`,
    };
  }
  return { ok: true, deck };
}

let nextImageAt = 0;

/** Waits for this server's next turn to ask Google for a slide picture. */
async function imageTurn(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextImageAt);
  nextImageAt = at + IMAGE_GAP_MS;
  if (at > now) await sleep(at - now);
}

/** One slide as Google draws it, 2000px wide, as WebP. */
export async function slidePicture(fileId: string, pageId: string): Promise<{ ok: true; image: Buffer } | DeckFailure> {
  await imageTurn();
  const read = await withSlides(async (slides) => {
    const thumb = await slides.call<{ contentUrl: string }>(
      "GET",
      `/presentations/${encodeURIComponent(fileId)}/pages/${encodeURIComponent(pageId)}/thumbnail`,
      { query: { "thumbnailProperties.thumbnailSize": IMAGE_SIZE, "thumbnailProperties.mimeType": "PNG" } },
    );
    const res = await fetch(thumb.contentUrl, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!res.ok) throw new Error(`Google's picture of the slide answered ${res.status}`);
    return sharp(Buffer.from(await res.arrayBuffer()))
      .webp({ quality: IMAGE_QUALITY })
      .toBuffer();
  });
  return read.ok ? { ok: true, image: read.value } : read;
}

/**
 * Training → Presentations: each one a Google Slides deck, read from Google
 * when it is added and whenever it is refreshed, its slides kept in deck order
 * with their speaker notes. A slide's picture is fetched from Google the first
 * time it is asked for and kept until the slide changes.
 */

import "server-only";

import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { PRESENTATION_LIMITS, presentationSlides, presentations, users } from "@/db/schema";
import type { PresentationSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { isUuid } from "@/lib/utils";
import type { Deck } from "./deck";
import { readDeck, slidePicture, type DeckFailure } from "./google";
import { slidesEditUrl } from "./link";

export type PresentationRow = {
  id: string;
  name: string;
  googleTitle: string;
  /** Slides that are presented: the deck's, less those skipped in Google. */
  slides: number;
  syncedAt: string;
};

export type PresentationSlide = {
  id: string;
  /** 1-based, counting skipped slides, as Google numbers them. */
  number: number;
  googlePageId: string;
  skipped: boolean;
  notes: string;
  /** Changes whenever the slide does, so its picture's address does too. */
  version: string;
  /** Whether its picture is already here, so showing it needs no call to Google. */
  cached: boolean;
};

export type Presentation = {
  id: string;
  name: string;
  googleFileId: string;
  googleTitle: string;
  googleUrl: string;
  syncedAt: string;
  createdAt: string;
  createdBy: string | null;
  slides: PresentationSlide[];
};

const p = presentations;
const s = presentationSlides;

// Spelled out: in a one-table query Drizzle leaves columns unqualified, and inside the subquery "id" would be the slide's own.
const presentedCount = sql<number>`(select count(*)::int from presentation_slides ps where ps.presentation_id = presentations.id and not ps.skipped)`;

const SORT_COLUMNS = {
  name: sql`lower(${p.name})`,
  slides: presentedCount,
  syncedAt: p.syncedAt,
};

/** Every presentation, a page at a time; searched by its name or its deck's title in Google. */
export async function listPresentations(query: ListQuery<PresentationSort>): Promise<Page<PresentationRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({ id: p.id, name: p.name, googleTitle: p.googleTitle, slides: presentedCount, syncedAt: p.syncedAt })
    .from(p)
    .where(searchAny(query.q, [p.name, p.googleTitle]))
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, p.id))
    .limit(limit)
    .offset(offset);
  return toPage(
    rows.map((r) => ({ ...r, syncedAt: r.syncedAt.toISOString() })),
    query.page,
  );
}

/** One presentation with every slide of its deck, in order; null if there is none. */
export async function getPresentation(id: string): Promise<Presentation | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({
      id: p.id,
      name: p.name,
      googleFileId: p.googleFileId,
      googleTitle: p.googleTitle,
      syncedAt: p.syncedAt,
      createdAt: p.createdAt,
      createdBy: users.name,
    })
    .from(p)
    .leftJoin(users, eq(users.id, p.createdBy))
    .where(eq(p.id, id));
  if (!row) return null;
  // A deck's slides are one document, not a list to page: at most PRESENTATION_LIMITS.slides of them.
  const slides = await db
    .select({
      id: s.id,
      position: s.position,
      googlePageId: s.googlePageId,
      skipped: s.skipped,
      notes: s.notes,
      fingerprint: s.fingerprint,
      cached: sql<boolean>`${s.image} is not null and ${s.imageFingerprint} = ${s.fingerprint}`,
    })
    .from(s)
    .where(eq(s.presentationId, id))
    .orderBy(s.position)
    .limit(PRESENTATION_LIMITS.slides);
  return {
    ...row,
    googleUrl: slidesEditUrl(row.googleFileId),
    syncedAt: row.syncedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    slides: slides.map(({ position, fingerprint, ...slide }) => ({ ...slide, number: position + 1, version: fingerprint.slice(0, 16) })),
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Makes the presentation's slides `deck`'s: new ones added, changed ones updated, gone ones removed. */
async function applyDeck(tx: Tx, presentationId: string, deck: Deck): Promise<void> {
  const ids = deck.slides.map((slide) => slide.googlePageId);
  await tx
    .delete(s)
    .where(ids.length ? and(eq(s.presentationId, presentationId), notInArray(s.googlePageId, ids)) : eq(s.presentationId, presentationId));
  if (deck.slides.length === 0) return;
  await tx
    .insert(s)
    .values(deck.slides.map((slide, position) => ({ ...slide, presentationId, position })))
    .onConflictDoUpdate({
      target: [s.presentationId, s.googlePageId],
      set: {
        position: sql`excluded.position`,
        skipped: sql`excluded.skipped`,
        notes: sql`excluded.notes`,
        fingerprint: sql`excluded.fingerprint`,
      },
    });
}

export type CreateResult = { ok: true; id: string; slides: number } | DeckFailure;

/** A new presentation of the deck `googleFileId`, read from Google now. */
export async function createPresentation(input: { name: string; googleFileId: string; createdBy: string }): Promise<CreateResult> {
  const read = await readDeck(input.googleFileId);
  if (!read.ok) return read;
  const { deck } = read;
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(p)
      .values({ name: input.name, googleFileId: input.googleFileId, googleTitle: deck.title, createdBy: input.createdBy })
      .returning({ id: p.id });
    await applyDeck(tx, row!.id, deck);
    return row!.id;
  });
  return { ok: true, id, slides: deck.slides.length };
}

export type SyncResult = { ok: true; name: string; slides: number; changed: number } | { ok: false; error: "not_found" } | DeckFailure;

/** Reads the presentation's deck from Google again; `changed` counts the slides that are new or look different. */
export async function syncPresentation(id: string): Promise<SyncResult> {
  if (!isUuid(id)) return { ok: false, error: "not_found" };
  const [row] = await db.select({ name: p.name, googleFileId: p.googleFileId }).from(p).where(eq(p.id, id));
  if (!row) return { ok: false, error: "not_found" };
  const read = await readDeck(row.googleFileId);
  if (!read.ok) return read;
  const { deck } = read;
  const before = new Map(
    (await db.select({ page: s.googlePageId, fingerprint: s.fingerprint }).from(s).where(eq(s.presentationId, id))).map((r) => [
      r.page,
      r.fingerprint,
    ]),
  );
  const changed = deck.slides.filter((slide) => before.get(slide.googlePageId) !== slide.fingerprint).length;
  await db.transaction(async (tx) => {
    await applyDeck(tx, id, deck);
    await tx.update(p).set({ googleTitle: deck.title, syncedAt: new Date() }).where(eq(p.id, id));
  });
  return { ok: true, name: row.name, slides: deck.slides.length, changed };
}

/** The presentation's name after renaming it; null if there is none. */
export async function renamePresentation(id: string, name: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.update(p).set({ name }).where(eq(p.id, id)).returning({ name: p.name });
  return row?.name ?? null;
}

/** The name of the presentation deleted, with its slides; null if there was none. The deck in Google is left alone. */
export async function deletePresentation(id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.delete(p).where(eq(p.id, id)).returning({ name: p.name });
  return row?.name ?? null;
}

/** Fetches already under way, so a slide asked for twice at once is fetched once. */
const fetching = new Map<string, Promise<Buffer | DeckFailure>>();

export type SlideImageResult = { ok: true; image: Buffer; current: boolean } | { ok: false; error: "not_found" } | DeckFailure;

/**
 * A slide's picture: the one kept here if the slide has not changed since,
 * else a new one from Google, kept for next time. If Google cannot be reached
 * the last one kept is served, `current: false`.
 */
export async function slideImage(presentationId: string, slideId: string): Promise<SlideImageResult> {
  if (!isUuid(presentationId) || !isUuid(slideId)) return { ok: false, error: "not_found" };
  const [row] = await db
    .select({
      fileId: p.googleFileId,
      pageId: s.googlePageId,
      fingerprint: s.fingerprint,
      image: s.image,
      imageFingerprint: s.imageFingerprint,
    })
    .from(s)
    .innerJoin(p, eq(p.id, s.presentationId))
    .where(and(eq(s.id, slideId), eq(s.presentationId, presentationId)));
  if (!row) return { ok: false, error: "not_found" };
  if (row.image && row.imageFingerprint === row.fingerprint) return { ok: true, image: row.image, current: true };

  let pending = fetching.get(slideId);
  if (!pending) {
    pending = slidePicture(row.fileId, row.pageId)
      .then(async (picture) => {
        if (!picture.ok) return picture;
        await db.update(s).set({ image: picture.image, imageFingerprint: row.fingerprint }).where(eq(s.id, slideId));
        return picture.image;
      })
      .finally(() => fetching.delete(slideId));
    fetching.set(slideId, pending);
  }
  const fetched = await pending;
  if (Buffer.isBuffer(fetched)) return { ok: true, image: fetched, current: true };
  if (row.image) return { ok: true, image: row.image, current: false };
  return fetched;
}

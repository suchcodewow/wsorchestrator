/**
 * Training → Presentations: each one a Google Slides deck, read from Google
 * when it is added and whenever it is refreshed, its slides kept in deck order
 * with their speaker notes. A slide's picture is fetched from Google the first
 * time it is asked for and kept until the slide changes.
 */

import "server-only";

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { PRESENTATION_LIMITS, presentationAssets, presentationPages, presentationSlides, presentations, users } from "@/db/schema";
import type { PresentationSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { isUuid } from "@/lib/utils";
import { convertSlide, type Conversion } from "./convert";
import type { Deck } from "./deck";
import { readDeck, slidePicture, type DeckFailure } from "./google";
import { slidesEditUrl } from "./link";
import { EMPTY_PAGE, pageAssets, type PageDocument } from "./page";

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
  pages: PresentationPage[];
};

/** One of the presentation's own pages; see `presentationPages`. */
export type PresentationPage = {
  id: string;
  /** The Google page id of the slide it comes just before; null for last. */
  before: string | null;
  position: number;
  document: PageDocument;
  notes: string;
  /** The Google page id of the slide it was converted from and stands in for; null for a page drawn here. */
  replaces: string | null;
  /** A converted page whose slide has changed in Google since. */
  stale: boolean;
  updatedAt: string;
};

const p = presentations;
const s = presentationSlides;
const pg = presentationPages;
const a = presentationAssets;

const PAGE_COLUMNS = {
  id: pg.id,
  before: pg.before,
  position: pg.position,
  document: pg.document,
  notes: pg.notes,
  replaces: pg.replaces,
  sourceFingerprint: pg.sourceFingerprint,
  updatedAt: pg.updatedAt,
};

type PageRow = {
  id: string;
  before: string | null;
  position: number;
  document: unknown;
  notes: string;
  replaces: string | null;
  sourceFingerprint: string | null;
  updatedAt: Date;
};

/** A stored page as the app reads it; `fingerprints` are the deck's slides', by Google page id, to tell a stale conversion. */
const asPage = ({ sourceFingerprint, ...row }: PageRow, fingerprints?: Map<string, string>): PresentationPage => ({
  ...row,
  // Stored only after `pageDocumentSchema` passed it.
  document: row.document as PageDocument,
  stale: Boolean(row.replaces && fingerprints && fingerprints.has(row.replaces) && fingerprints.get(row.replaces) !== sourceFingerprint),
  updatedAt: row.updatedAt.toISOString(),
});

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
  const pages = await db
    .select(PAGE_COLUMNS)
    .from(pg)
    .where(eq(pg.presentationId, id))
    .orderBy(pg.position)
    .limit(PRESENTATION_LIMITS.pages);
  return {
    ...row,
    googleUrl: slidesEditUrl(row.googleFileId),
    syncedAt: row.syncedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    slides: slides.map(({ position, fingerprint, ...slide }) => ({ ...slide, number: position + 1, version: fingerprint.slice(0, 16) })),
    pages: pages.map((page) => asPage(page, new Map(slides.map((slide) => [slide.googlePageId, slide.fingerprint])))),
  };
}

/** One of a presentation's own pages, with the presentation's name; null if there is none. */
export async function getPage(
  presentationId: string,
  pageId: string,
): Promise<{ page: PresentationPage; presentationName: string } | null> {
  if (!isUuid(presentationId) || !isUuid(pageId)) return null;
  const [row] = await db
    .select({ page: PAGE_COLUMNS, presentationName: p.name })
    .from(pg)
    .innerJoin(p, eq(p.id, pg.presentationId))
    .where(and(eq(pg.id, pageId), eq(pg.presentationId, presentationId)));
  return row ? { page: asPage(row.page), presentationName: row.presentationName } : null;
}

export type CreatePageResult = { ok: true; id: string; name: string } | { ok: false; error: "not_found" | "too_many_pages" };

/** A new blank page before the slide `before` (null: last), after any already there. */
export async function createPage(presentationId: string, before: string | null, userId: string): Promise<CreatePageResult> {
  if (!isUuid(presentationId)) return { ok: false, error: "not_found" };
  const [row] = await db
    .select({
      name: p.name,
      pages: sql<number>`(select count(*)::int from presentation_pages pp where pp.presentation_id = presentations.id)`,
    })
    .from(p)
    .where(eq(p.id, presentationId));
  if (!row) return { ok: false, error: "not_found" };
  if (row.pages >= PRESENTATION_LIMITS.pages) return { ok: false, error: "too_many_pages" };
  const [page] = await db
    .insert(pg)
    .values({
      presentationId,
      before,
      position: sql`(select coalesce(max(position), -1) + 1 from presentation_pages where presentation_id = ${presentationId})`,
      document: EMPTY_PAGE,
      updatedBy: userId,
    })
    .returning({ id: pg.id });
  return { ok: true, id: page!.id, name: row.name };
}

export type SavePageResult = { ok: true; name: string } | { ok: false; error: "not_found" | "unknown_asset" };

/**
 * Saves a page: its drawing, its notes, and the slide it comes before. A page
 * moved to another slide goes after the pages already there; a converted page
 * stays where its slide is. Every picture it draws must be one of this
 * presentation's.
 */
export async function savePage(
  presentationId: string,
  pageId: string,
  input: { before: string | null; document: PageDocument; notes: string },
  userId: string,
): Promise<SavePageResult> {
  if (!isUuid(presentationId) || !isUuid(pageId)) return { ok: false, error: "not_found" };
  const [current] = await db
    .select({ before: pg.before, replaces: pg.replaces, name: p.name })
    .from(pg)
    .innerJoin(p, eq(p.id, pg.presentationId))
    .where(and(eq(pg.id, pageId), eq(pg.presentationId, presentationId)));
  if (!current) return { ok: false, error: "not_found" };
  const wanted = pageAssets(input.document);
  if (wanted.length) {
    const found = await db
      .select({ id: a.id })
      .from(a)
      .where(and(eq(a.presentationId, presentationId), inArray(a.id, wanted)));
    if (found.length !== new Set(wanted).size) return { ok: false, error: "unknown_asset" };
  }
  const before = current.replaces ?? input.before;
  const moved = current.before !== before;
  await db.transaction(async (tx) => {
    await tx
      .update(pg)
      .set({
        before,
        document: input.document,
        notes: input.notes,
        updatedBy: userId,
        updatedAt: new Date(),
        ...(moved
          ? { position: sql`(select coalesce(max(position), -1) + 1 from presentation_pages where presentation_id = ${presentationId})` }
          : {}),
      })
      .where(eq(pg.id, pageId));
    await pruneAssets(tx, presentationId);
  });
  return { ok: true, name: current.name };
}

/** The name of the presentation a page was removed from; null if there was no such page. A converted page's slide shows again. */
export async function deletePage(presentationId: string, pageId: string): Promise<string | null> {
  if (!isUuid(presentationId) || !isUuid(pageId)) return null;
  const name = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(pg)
      .where(and(eq(pg.id, pageId), eq(pg.presentationId, presentationId)))
      .returning({ id: pg.id });
    if (!row) return null;
    await pruneAssets(tx, presentationId);
    const [presentation] = await tx.select({ name: p.name }).from(p).where(eq(p.id, presentationId));
    return presentation?.name ?? "";
  });
  return name;
}

/** Removes the presentation's pictures that no page draws any longer. */
async function pruneAssets(tx: Tx, presentationId: string): Promise<void> {
  await tx.execute(sql`
    delete from presentation_assets pa
     where pa.presentation_id = ${presentationId}
       and not exists (
         select 1 from presentation_pages pp
          where pp.presentation_id = pa.presentation_id and pp.document::text like '%' || pa.id::text || '%'
       )`);
}

/** One of the presentation's pictures; null if there is none. */
export async function getAsset(presentationId: string, assetId: string): Promise<Buffer | null> {
  if (!isUuid(presentationId) || !isUuid(assetId)) return null;
  const [row] = await db
    .select({ image: a.image })
    .from(a)
    .where(and(eq(a.id, assetId), eq(a.presentationId, presentationId)));
  return row?.image ?? null;
}

export type ConvertResult =
  | { ok: true; pageId: string; name: string; live: number; animated: number; animationsRead: boolean }
  | { ok: false; error: "not_found" | "skipped" | "too_many_pages" }
  | DeckFailure;

/**
 * Converts slide `slideId` into one of the presentation's own pages that
 * stands in for it (see `convert.ts`), replacing any page converted from it
 * before. The slide's speaker notes come with it.
 */
export async function saveConversion(presentationId: string, slideId: string, userId: string): Promise<ConvertResult> {
  if (!isUuid(presentationId) || !isUuid(slideId)) return { ok: false, error: "not_found" };
  const [slide] = await db
    .select({
      name: p.name,
      fileId: p.googleFileId,
      pageId: s.googlePageId,
      skipped: s.skipped,
      notes: s.notes,
      fingerprint: s.fingerprint,
      pages: sql<number>`(select count(*)::int from presentation_pages pp where pp.presentation_id = ${presentationId})`,
    })
    .from(s)
    .innerJoin(p, eq(p.id, s.presentationId))
    .where(and(eq(s.id, slideId), eq(s.presentationId, presentationId)));
  if (!slide) return { ok: false, error: "not_found" };
  if (slide.skipped) return { ok: false, error: "skipped" };
  if (slide.pages >= PRESENTATION_LIMITS.pages) return { ok: false, error: "too_many_pages" };

  const converted = await convertSlide(slide.fileId, slide.pageId);
  if (!converted.ok) return converted;
  const { conversion } = converted;

  const pageId = await storeConversion(presentationId, slide, conversion, userId);
  return {
    ok: true,
    pageId,
    name: slide.name,
    live: conversion.live,
    animated: conversion.animated,
    animationsRead: conversion.animationsRead,
  };
}

/**
 * Keeps a conversion of the slide `slide.pageId`: its pictures, and the page
 * that stands in for the slide, in the place of any page converted from it
 * before. Returns the new page's id.
 */
export async function storeConversion(
  presentationId: string,
  slide: { pageId: string; fingerprint: string; notes: string },
  conversion: Conversion,
  userId: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [earlier] = await tx
      .delete(pg)
      .where(and(eq(pg.presentationId, presentationId), eq(pg.replaces, slide.pageId)))
      .returning({ position: pg.position });
    await tx.insert(a).values(conversion.assets.map((asset) => ({ ...asset, presentationId })));
    const [page] = await tx
      .insert(pg)
      .values({
        presentationId,
        before: slide.pageId,
        replaces: slide.pageId,
        sourceFingerprint: slide.fingerprint,
        position:
          earlier?.position ??
          sql`(select coalesce(max(position), -1) + 1 from presentation_pages where presentation_id = ${presentationId})`,
        document: conversion.document,
        notes: slide.notes,
        updatedBy: userId,
      })
      .returning({ id: pg.id });
    await pruneAssets(tx, presentationId);
    return page!.id;
  });
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

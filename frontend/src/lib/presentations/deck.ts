/**
 * A Google Slides presentation, as `presentations.get` returns it, read into
 * what a presentation keeps: each slide in order, whether it is skipped, its
 * speaker notes, and a fingerprint of what draws it. Pure, so it is tested
 * without Google.
 */

import { createHash } from "node:crypto";

/** The `fields` mask `readDeck` asks for: enough to fingerprint every slide, its layout and its master. */
export const DECK_FIELDS = [
  "title",
  "slides(objectId,pageElements,pageProperties,slideProperties)",
  "layouts(objectId,pageElements,pageProperties,layoutProperties(masterObjectId))",
  "masters(objectId,pageElements,pageProperties)",
].join(",");

type Json = unknown;

type ApiPage = {
  objectId: string;
  pageElements?: Json[];
  pageProperties?: Json;
};

type NotesElement = {
  objectId?: string;
  shape?: { text?: { textElements?: { textRun?: { content?: string } }[] } };
};

export type ApiSlide = ApiPage & {
  slideProperties?: {
    layoutObjectId?: string;
    masterObjectId?: string;
    isSkipped?: boolean;
    notesPage?: {
      notesProperties?: { speakerNotesObjectId?: string };
      pageElements?: NotesElement[];
    };
  };
};

export type ApiPresentation = {
  title?: string;
  slides?: ApiSlide[];
  layouts?: (ApiPage & { layoutProperties?: { masterObjectId?: string } })[];
  masters?: ApiPage[];
};

export type DeckSlide = {
  googlePageId: string;
  skipped: boolean;
  notes: string;
  fingerprint: string;
};

export type Deck = { title: string; slides: DeckSlide[] };

/**
 * `value` with every `contentUrl` taken out. Google signs those afresh on
 * every read, so leaving them in would make every slide look changed.
 */
function withoutContentUrls(value: Json): Json {
  if (Array.isArray(value)) return value.map(withoutContentUrls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, Json>)
        .filter(([key]) => key !== "contentUrl")
        .map(([key, v]) => [key, withoutContentUrls(v)]),
    );
  }
  return value;
}

const hash = (value: Json) =>
  createHash("sha256")
    .update(JSON.stringify(withoutContentUrls(value)))
    .digest("hex");

/** The speaker notes Google shows under a slide: the text of its notes page's speaker-notes shape. */
export function speakerNotes(slide: ApiSlide): string {
  const notes = slide.slideProperties?.notesPage;
  const id = notes?.notesProperties?.speakerNotesObjectId;
  const shape = notes?.pageElements?.find((e) => e.objectId === id)?.shape;
  const text = (shape?.text?.textElements ?? []).map((e) => e.textRun?.content ?? "").join("");
  return text.replace(/\s+$/, "");
}

export function readDeckJson(json: ApiPresentation): Deck {
  const pageHash = new Map<string, string>();
  for (const page of [...(json.layouts ?? []), ...(json.masters ?? [])]) {
    pageHash.set(page.objectId, hash({ pageElements: page.pageElements ?? [], pageProperties: page.pageProperties ?? {} }));
  }
  const layoutMaster = new Map((json.layouts ?? []).map((l) => [l.objectId, l.layoutProperties?.masterObjectId]));

  const slides = (json.slides ?? []).map((slide): DeckSlide => {
    const props = slide.slideProperties ?? {};
    const layout = props.layoutObjectId;
    const master = props.masterObjectId ?? (layout ? layoutMaster.get(layout) : undefined);
    // The notes page is left out: editing the notes changes nothing on the slide.
    const fingerprint = hash({
      pageElements: slide.pageElements ?? [],
      pageProperties: slide.pageProperties ?? {},
      layout: layout ? (pageHash.get(layout) ?? layout) : null,
      master: master ? (pageHash.get(master) ?? master) : null,
    });
    return { googlePageId: slide.objectId, skipped: props.isSkipped === true, notes: speakerNotes(slide), fingerprint };
  });

  return { title: json.title ?? "", slides };
}

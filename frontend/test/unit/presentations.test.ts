/**
 * Reading a Google Slides deck for Presentations: the Drive id in whatever
 * link someone pastes, and the slides `presentations.get` returns — their
 * order, skipped slides, speaker notes, and a fingerprint that changes when a
 * slide would look different and only then.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { readDeckJson, speakerNotes, type ApiPresentation, type ApiSlide } from "@/lib/presentations/deck";
import { keyAction, presentedSlides } from "@/lib/presentations/live";
import { slidesFileId } from "@/lib/presentations/link";

const ID = "1pLXiQ6i0qAW1Q0KoLof7qa8dvZWtg8qSJzJkGw4r79M";

describe("slidesFileId", () => {
  test("reads the id from the links Google gives out", () => {
    for (const link of [
      `https://docs.google.com/presentation/d/${ID}/edit?slide=id.h264761aa1f26385f_1_2649#slide=id.h264761aa1f26385f_1_2649`,
      `https://docs.google.com/presentation/d/${ID}/edit?usp=drivesdk&ouid=107307499275743930953`,
      `https://docs.google.com/presentation/u/0/d/${ID}/present`,
      `https://docs.google.com/presentation/d/${ID}`,
      `  ${ID}  `,
    ]) {
      assert.equal(slidesFileId(link), ID, link);
    }
  });

  test("refuses anything that is not a Slides deck", () => {
    for (const link of [
      "",
      "not a link",
      `https://docs.google.com/document/d/${ID}/edit`,
      `https://evil.example.com/presentation/d/${ID}/edit`,
      "https://docs.google.com/presentation/d/short/edit",
    ]) {
      assert.equal(slidesFileId(link), null, link);
    }
  });
});

function slide(objectId: string, over: Partial<ApiSlide> = {}, notes?: string): ApiSlide {
  return {
    objectId,
    pageElements: [{ objectId: `${objectId}_t`, shape: { shapeType: "TEXT_BOX" } }],
    ...over,
    slideProperties: {
      layoutObjectId: "layout1",
      ...over.slideProperties,
      notesPage: {
        notesProperties: { speakerNotesObjectId: "notes_body" },
        pageElements: [
          { objectId: "notes_title", shape: { text: { textElements: [{ textRun: { content: "not the notes" } }] } } },
          ...(notes === undefined
            ? []
            : [
                {
                  objectId: "notes_body",
                  shape: { text: { textElements: [{}, { textRun: { content: notes } }, { textRun: { content: "\n" } }] } },
                },
              ]),
        ],
      },
    },
  };
}

function deck(slides: ApiSlide[], layoutColor = "red"): ApiPresentation {
  return {
    title: "Animation Test",
    slides,
    layouts: [{ objectId: "layout1", pageProperties: { color: layoutColor }, layoutProperties: { masterObjectId: "master1" } }],
    masters: [{ objectId: "master1", pageElements: [] }],
  };
}

describe("readDeckJson", () => {
  test("keeps the deck's order, its skipped slides and each slide's speaker notes", () => {
    const read = readDeckJson(
      deck([slide("a", {}, "First line.\nSecond line."), slide("b", { slideProperties: { isSkipped: true } }), slide("c")]),
    );
    assert.equal(read.title, "Animation Test");
    assert.deepEqual(
      read.slides.map((s) => [s.googlePageId, s.skipped, s.notes]),
      [
        ["a", false, "First line.\nSecond line."],
        ["b", true, ""],
        ["c", false, ""],
      ],
    );
  });

  test("reads the notes from the speaker-notes shape alone, without its trailing newline", () => {
    assert.equal(speakerNotes(slide("a", {}, "Say this.")), "Say this.");
    assert.equal(speakerNotes(slide("a")), "");
  });

  test("gives a slide the same fingerprint however Google signs its image links", () => {
    const withImage = (url: string) =>
      readDeckJson(
        deck([slide("a", { pageElements: [{ objectId: "img", image: { contentUrl: url, sourceUrl: "https://x/logo.png" } }] })]),
      );
    assert.equal(
      withImage("https://lh7-us.googleusercontent.com/one?key=1").slides[0]!.fingerprint,
      withImage("https://lh7-us.googleusercontent.com/two?key=2").slides[0]!.fingerprint,
    );
  });

  test("changes a slide's fingerprint when it, its layout or its master changes, but not when only its notes do", () => {
    const base = readDeckJson(deck([slide("a", {}, "Notes.")])).slides[0]!.fingerprint;
    assert.equal(readDeckJson(deck([slide("a", {}, "Other notes.")])).slides[0]!.fingerprint, base);
    assert.notEqual(readDeckJson(deck([slide("a", { pageElements: [] }, "Notes.")])).slides[0]!.fingerprint, base);
    assert.notEqual(readDeckJson(deck([slide("a", {}, "Notes.")], "blue")).slides[0]!.fingerprint, base);
  });
});

describe("presenting", () => {
  test("presents every slide not skipped, in order", () => {
    assert.deepEqual(
      presentedSlides([
        { id: "1", skipped: false },
        { id: "2", skipped: true },
        { id: "3", skipped: false },
      ]).map((s) => s.id),
      ["1", "3"],
    );
  });

  test("moves on the keys a keyboard and a presentation clicker send", () => {
    const key = (k: string, mods: Partial<KeyboardEvent> = {}) => keyAction({ key: k, ...mods } as KeyboardEvent);
    assert.deepEqual(
      ["ArrowRight", "PageDown", " ", "ArrowLeft", "PageUp", "Home", "End", "b"].map((k) => key(k)),
      ["next", "next", "next", "previous", "previous", "first", "last", "black"],
    );
    assert.equal(key("ArrowRight", { metaKey: true }), null);
    assert.equal(key("x"), null);
  });
});

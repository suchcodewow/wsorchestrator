/**
 * Converting a Google slide into a page of the presentation's own: which
 * elements become live, the requests that separate them in a scratch copy of
 * the deck, the order Google's animations reveal them in (read from a real
 * PowerPoint export), where each lies in Google's picture of the slide, and
 * the converted page standing in for its slide.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  animationPlan,
  copyId,
  backdropRequests,
  CUT_PADDING,
  liftable,
  objectIds,
  isolationRequests,
  shapeIndexes,
  unmatte,
  type ApiElement,
} from "@/lib/presentations/convert-plan";
import { showItems, type LivePage, type LiveSlide } from "@/lib/presentations/live";
import { EMPTY_PAGE, newElement, pageAssets, pageDocumentSchema } from "@/lib/presentations/page";

const EXPORTED = readFileSync(join(import.meta.dirname, "fixtures/pptx-slide-click-builds.xml"), "utf8");

describe("reading Google's animations from its PowerPoint export", () => {
  test("indexes each shape by its place in the slide's stacking order", () => {
    const indexes = shapeIndexes(EXPORTED);
    assert.equal(indexes.size, 6);
    assert.deepEqual([...new Set(indexes.values())].sort(), [0, 1, 2, 3, 4, 5]);
  });

  test("gives each click its own step, with the shape it reveals and Google's effect", () => {
    assert.deepEqual(
      [...animationPlan(EXPORTED).entries()],
      [
        [3, { step: 1, effect: "appear" }],
        [5, { step: 2, effect: "appear" }],
      ],
    );
  });

  const slideWith = (timing: string) =>
    `<p:sld><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/></p:grpSpPr>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="10" name="a"/></p:nvSpPr></p:sp>` +
    `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="20" name="g"/></p:nvGrpSpPr><p:sp><p:nvSpPr><p:cNvPr id="21" name="in g"/></p:nvSpPr></p:sp></p:grpSp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="30" name="c"/></p:nvSpPr></p:sp>` +
    `</p:spTree></p:cSld><p:timing>${timing}</p:timing></p:sld>`;
  const effect = (node: string, preset: string, spid: string, cls = "entr") =>
    `<p:cTn fill="hold" nodeType="${node}" presetClass="${cls}" presetID="${preset}"><p:spTgt spid="${spid}"/></p:cTn>`;

  test("joins an effect 'with' or 'after' the one before to its click, and maps a grouped shape to its group", () => {
    const plan = animationPlan(
      slideWith(effect("clickEffect", "10", "10") + effect("withEffect", "2", "21") + effect("clickEffect", "22", "30")),
    );
    assert.deepEqual(
      [...plan.entries()],
      [
        [0, { step: 1, effect: "fade" }],
        [1, { step: 1, effect: "rise" }],
        [2, { step: 2, effect: "wipe" }],
      ],
    );
  });

  test("makes what plays with the slide before any click an on-entry reveal, and leaves out exits and emphasis", () => {
    const plan = animationPlan(
      slideWith(effect("withEffect", "10", "10") + effect("clickEffect", "10", "21", "exit") + effect("clickEffect", "1", "30")),
    );
    assert.deepEqual(
      [...plan.entries()],
      [
        [0, { step: 0, effect: "fade", delay: 0 }],
        [2, { step: 2, effect: "appear" }],
      ],
    );
  });

  test("times on-entry effects as Google plays them: 'with' alongside the one before, 'after' once it ends, each plus its own delay", () => {
    // As the export writes it: the effect's own delay first, its shape, then how long its animation runs.
    const timed = (node: string, spid: string, delay: number, dur?: number) =>
      `<p:cTn fill="hold" nodeType="${node}" presetClass="entr" presetID="10"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst>` +
      `<p:childTnLst><p:set><p:cBhvr><p:cTn dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:set>` +
      (dur ? `<p:animEffect><p:cBhvr><p:cTn dur="${dur}"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>` : "") +
      `</p:childTnLst></p:cTn>`;
    const plan = animationPlan(
      slideWith(timed("withEffect", "10", 0, 1000) + timed("afterEffect", "21", 200, 800) + timed("withEffect", "30", 100)),
    );
    assert.deepEqual(
      [...plan.entries()].map(([index, p]) => [index, p.delay]),
      [
        [0, 0],
        [1, 1200],
        [2, 1300],
      ],
    );
  });

  test("reads a real slide whose shapes fade in together as it opens", () => {
    const plan = animationPlan(readFileSync(join(import.meta.dirname, "fixtures/pptx-slide-entry-fades.xml"), "utf8"));
    assert.equal(plan.size, 4);
    assert.deepEqual(
      [...plan.values()].map((p) => [p.step, p.effect, p.delay]),
      Array.from({ length: 4 }, () => [0, "fade", 0]),
    );
  });

  test("finds no plan in a slide without animations", () => {
    assert.equal(animationPlan("<p:sld><p:cSld><p:spTree></p:spTree></p:cSld></p:sld>").size, 0);
  });
});

const PAGE_SIZE = { width: 9144000, height: 5143500 };
const box = (id: string, w: number, h: number, children?: ApiElement[]): ApiElement => ({
  objectId: id,
  size: { width: { magnitude: w }, height: { magnitude: h } },
  transform: { scaleX: 1, scaleY: 1 },
  ...(children ? { elementGroup: { children } } : {}),
});

describe("choosing the live elements", () => {
  test("keeps an element as big as the slide in the background", () => {
    const elements = [box("bg", 9144000, 5143500), box("title", 4000000, 600000), box("card", 2000000, 1000000)];
    assert.deepEqual(liftable(elements, PAGE_SIZE, new Set()), [1, 2]);
  });

  test("past the limit keeps the animated ones, then the topmost, in stacking order", () => {
    const elements = Array.from({ length: 50 }, (_, i) => box(`e${i}`, 100, 100));
    const lifted = liftable(elements, PAGE_SIZE, new Set([0, 1]));
    assert.equal(lifted.length, 40);
    assert.deepEqual(lifted.slice(0, 3), [0, 1, 12]);
    assert.equal(lifted.at(-1), 49);
  });
});

describe("isolating the live elements in the scratch copy", () => {
  const elements = [box("bg", 9144000, 5143500), box("a", 10, 10), box("g", 10, 10, [box("g1", 5, 5), box("g2", 5, 5)])];
  type Request = Record<string, { objectId: string; objectIds?: Record<string, string>; pageProperties?: unknown }>;
  const requests = isolationRequests("slide", elements, [1, 2]) as Request[];

  test("names every grouped object as well as the group", () => {
    assert.deepEqual(objectIds(elements[2]!), ["g", "g1", "g2"]);
  });

  test("gives each live element a copy on black and one on white, every object in it named", () => {
    const copies = requests.filter((r) => r.duplicateObject).map((r) => r.duplicateObject!);
    assert.deepEqual(
      copies.map((c) => c.objectIds!.slide),
      ["slide_b0", "slide_w0", "slide_b1", "slide_w1"],
    );
    assert.deepEqual(copies[0]!.objectIds, { slide: "slide_b0", bg: "bg_b0", a: "a_b0", g: "g_b0", g1: "g1_b0", g2: "g2_b0" });
    const backdrops = requests
      .filter((r) => r.updatePageProperties)
      .map((r) => [r.updatePageProperties!.objectId, JSON.stringify(r.updatePageProperties!.pageProperties)]);
    assert.deepEqual(
      backdrops.map(([id, fill]) => [id, fill!.includes('"red":1')]),
      [
        ["slide_b0", false],
        ["slide_w0", true],
        ["slide_b1", false],
        ["slide_w1", true],
      ],
    );
  });

  test("leaves each copy its one element, background and all others gone, and strips the live ones from the slide", () => {
    const deleted = requests.filter((r) => r.deleteObject).map((r) => r.deleteObject!.objectId);
    assert.deepEqual(deleted, [
      copyId("bg", 0, "black"),
      copyId("g", 0, "black"),
      copyId("bg", 0, "white"),
      copyId("g", 0, "white"),
      copyId("bg", 1, "black"),
      copyId("a", 1, "black"),
      copyId("bg", 1, "white"),
      copyId("a", 1, "white"),
      "a",
      "g",
    ]);
  });

  test("clears what the layout and master draw, but keeps their placeholders, which the slide's text takes its style from", () => {
    const pages = [
      { pageElements: [{ objectId: "logo" }, { objectId: "title-style", shape: { placeholder: { type: "TITLE" } } }] },
      { pageElements: [{ objectId: "stripe", shape: {} }] },
    ];
    assert.deepEqual(
      (backdropRequests(pages) as { deleteObject: { objectId: string } }[]).map((r) => r.deleteObject.objectId),
      ["logo", "stripe"],
    );
  });
});

describe("unmatte", () => {
  /** A 4×1 picture of an element alone, as Google draws it on `backdrop`: opaque red, half-clear black, nothing, opaque white. */
  const drawn = (backdrop: 0 | 255) =>
    new Uint8Array(
      [255, 0, 0, 128 * (backdrop / 255), 128 * (backdrop / 255), 128 * (backdrop / 255), backdrop, backdrop, backdrop, 255, 255, 255].map(
        Math.round,
      ),
    );

  test("recovers each pixel's colour and opacity from the element on black and on white", () => {
    const { rgba } = unmatte(drawn(0), drawn(255), 4, 1);
    const px = (i: number) => [...rgba.slice(i * 4, i * 4 + 4)];
    assert.deepEqual(px(0), [255, 0, 0, 255]);
    assert.deepEqual(px(1).slice(0, 3), [0, 0, 0]);
    assert.ok(Math.abs(px(1)[3]! - 127) <= 1, `half clear, got ${px(1)[3]}`);
    assert.equal(px(2)[3], 0);
    // White on white is not mistaken for a hole: on black it is still white.
    assert.deepEqual(px(3), [255, 255, 255, 255]);
  });

  test("boxes every visible pixel, padded and kept inside the picture", () => {
    const w = 100;
    const h = 60;
    const black = new Uint8Array(w * h * 3);
    const white = new Uint8Array(w * h * 3).fill(255);
    for (let y = 20; y < 30; y++) {
      for (let x = 40; x < 50; x++) {
        black.fill(200, (y * w + x) * 3, (y * w + x) * 3 + 3);
        white.fill(200, (y * w + x) * 3, (y * w + x) * 3 + 3);
      }
    }
    assert.deepEqual(unmatte(black, white, w, h).box, {
      left: 40 - CUT_PADDING,
      top: 20 - CUT_PADDING,
      width: 10 + 2 * CUT_PADDING,
      height: 10 + 2 * CUT_PADDING,
    });
  });

  test("finds nothing in a picture of nothing", () => {
    assert.equal(unmatte(new Uint8Array(12), new Uint8Array(12).fill(255), 2, 2).box, null);
  });
});

describe("a converted slide", () => {
  const slide = (n: number): LiveSlide => ({
    id: `s${n}`,
    number: n,
    googlePageId: `g${n}`,
    skipped: false,
    notes: "",
    version: "v",
    cached: true,
  });
  const page = (id: string, before: string, position: number, replaces?: string): LivePage => ({
    id,
    before,
    position,
    notes: "",
    replaces,
    document: EMPTY_PAGE,
  });

  test("stands in for its slide, after any page put before that slide", () => {
    const items = showItems([slide(1), slide(2), slide(3)], [page("dynamic", "g2", 5, "g2"), page("earlier", "g2", 1)]);
    assert.deepEqual(
      items.map((i) => i.id),
      ["s1", "earlier", "dynamic", "s3"],
    );
  });

  test("draws pictures only of the presentation's assets, named by id, and lists every one it draws", () => {
    const asset = "4b9f3e1c-2a7d-4c55-9a51-0d9d6a1f2b3c";
    const doc = { ...EMPTY_PAGE, backgroundImage: asset, elements: [{ ...newElement("image", "pic"), src: asset }] };
    assert.ok(pageDocumentSchema.safeParse(doc).success);
    assert.deepEqual(pageAssets(doc), [asset, asset]);
    assert.ok(!pageDocumentSchema.safeParse({ ...doc, backgroundImage: "../../etc" }).success);
  });

  test("reads a page saved before pictures and border effects existed", () => {
    const old = { background: "#ffffff", elements: [{ ...newElement("rect", "r"), src: undefined, border: undefined }] };
    const parsed = pageDocumentSchema.parse(old);
    assert.equal(parsed.backgroundImage, null);
    assert.equal(parsed.elements[0]!.border, null);
  });
});

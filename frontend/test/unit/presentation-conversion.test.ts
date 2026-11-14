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
  CUT_PADDING,
  differenceBox,
  liftable,
  objectIds,
  separationRequests,
  shapeIndexes,
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

  test("leaves out what plays with the slide before any click, and exits and emphasis", () => {
    const plan = animationPlan(
      slideWith(effect("withEffect", "10", "10") + effect("clickEffect", "10", "21", "exit") + effect("clickEffect", "1", "30")),
    );
    assert.deepEqual([...plan.entries()], [[2, { step: 2, effect: "appear" }]]);
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

describe("separating the live elements in the scratch copy", () => {
  const elements = [box("bg", 9144000, 5143500), box("a", 10, 10), box("g", 10, 10, [box("g1", 5, 5), box("g2", 5, 5)])];

  test("names every grouped object as well as the group", () => {
    assert.deepEqual(objectIds(elements[2]!), ["g", "g1", "g2"]);
  });

  test("makes a copy per live element holding it alone, and strips them all from the slide itself", () => {
    const requests = separationRequests("slide", elements, [1, 2]) as Record<
      string,
      { objectId: string; objectIds?: Record<string, string> }
    >[];
    const copies = requests.filter((r) => r.duplicateObject).map((r) => r.duplicateObject!);
    assert.equal(copies.length, 2);
    assert.deepEqual(copies[0]!.objectIds, { slide: "slide_c0", a: "a_c0", g: "g_c0", g1: "g1_c0", g2: "g2_c0" });
    const deleted = requests.filter((r) => r.deleteObject).map((r) => r.deleteObject!.objectId);
    // Copy 0 keeps a and loses g; copy 1 keeps g and loses a; the slide loses both; the background is never touched.
    assert.deepEqual(deleted, [copyId("g", 0), copyId("a", 1), "a", "g"]);
  });
});

describe("differenceBox", () => {
  const picture = (w: number, h: number, paint?: [number, number, number, number]) => {
    const px = new Uint8Array(w * h * 3).fill(255);
    if (paint) {
      const [x0, y0, x1, y1] = paint;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.fill(0, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
    return px;
  };

  test("boxes what differs, padded, and kept inside the picture", () => {
    assert.deepEqual(differenceBox(picture(100, 60), picture(100, 60, [40, 20, 50, 30]), 100, 60), {
      left: 40 - CUT_PADDING,
      top: 20 - CUT_PADDING,
      width: 10 + 2 * CUT_PADDING,
      height: 10 + 2 * CUT_PADDING,
    });
    assert.deepEqual(differenceBox(picture(100, 60), picture(100, 60, [0, 0, 3, 3]), 100, 60), {
      left: 0,
      top: 0,
      width: 3 + CUT_PADDING,
      height: 3 + CUT_PADDING,
    });
  });

  test("is null for two pictures alike but for faint anti-aliasing", () => {
    const faint = picture(20, 20);
    faint[30] = 240;
    assert.equal(differenceBox(picture(20, 20), faint, 20, 20), null);
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

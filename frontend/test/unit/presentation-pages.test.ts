/**
 * A presentation's own pages: where they fall among the deck's slides, how
 * their reveals play out press by press and click by click, what a stored page
 * may hold, the reveal grid's hidden answers, and the editor's snapping.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { showItems, type LivePage, type LiveSlide } from "@/lib/presentations/live";
import {
  builtState,
  EMPTY_PAGE,
  isShown,
  newElement,
  pageDocumentSchema,
  revealGrid,
  revealSteps,
  START,
  toggleTrigger,
  triggers,
  type PageDocument,
  type PageElement,
} from "@/lib/presentations/page";
import { snapBox, SNAP } from "@/lib/presentations/snap";

const slide = (n: number, skipped = false): LiveSlide => ({
  id: `slide${n}`,
  number: n,
  googlePageId: `g${n}`,
  skipped,
  notes: "",
  version: "v",
  cached: true,
});

const page = (id: string, before: string | null, position: number): LivePage => ({ id, before, position, notes: "", document: EMPTY_PAGE });

describe("showItems", () => {
  test("puts each page just before its slide, in the order the pages were added there", () => {
    const items = showItems(
      [slide(1), slide(2), slide(3), slide(4), slide(5)],
      [page("b", "g3", 2), page("a", "g3", 1), page("c", null, 0)],
    );
    assert.deepEqual(
      items.map((i) => i.id),
      ["slide1", "slide2", "a", "b", "slide3", "slide4", "slide5", "c"],
    );
  });

  test("keeps a page before a skipped slide where that slide was, and moves one whose slide is gone to the end", () => {
    const items = showItems([slide(1), slide(2, true), slide(3)], [page("before-skipped", "g2", 0), page("orphan", "g9", 1)]);
    assert.deepEqual(
      items.map((i) => i.id),
      ["slide1", "before-skipped", "slide3", "orphan"],
    );
  });

  test("lists skipped slides in their place when asked to, for the deck's page", () => {
    assert.deepEqual(
      showItems([slide(1), slide(2, true)], [], true).map((i) => i.id),
      ["slide1", "slide2"],
    );
  });
});

const el = (id: string, reveal: PageElement["reveal"] = null): PageElement => ({ ...newElement("rect", id), reveal });

describe("reveals", () => {
  const doc: PageDocument = {
    background: "#ffffff",
    backgroundImage: null,
    elements: [
      el("title"),
      el("third", { on: "next", order: 3, effect: "fade" }),
      el("first", { on: "next", order: 1, effect: "fade" }),
      el("second-a", { on: "next", order: 2, effect: "rise" }),
      el("second-b", { on: "next", order: 2, effect: "rise" }),
      el("card"),
      el("answer", { on: "click", by: "card", effect: "zoom" }),
    ],
  };
  const shownAt = (state: typeof START) => doc.elements.filter((e) => isShown(doc, e, state)).map((e) => e.id);

  test("uncovers the 'on next' elements one order at a time, those sharing an order together", () => {
    assert.equal(revealSteps(doc).length, 3);
    assert.deepEqual(shownAt(START), ["title", "card"]);
    assert.deepEqual(shownAt({ step: 1, clicked: [] }), ["title", "first", "card"]);
    assert.deepEqual(shownAt({ step: 2, clicked: [] }), ["title", "first", "second-a", "second-b", "card"]);
    assert.deepEqual(shownAt({ step: 3, clicked: [] }), ["title", "third", "first", "second-a", "second-b", "card"]);
  });

  test("a click on a trigger opens what it reveals, and a second click closes it again", () => {
    assert.deepEqual([...triggers(doc)], ["card"]);
    const opened = toggleTrigger(START, "card");
    assert.ok(isShown(doc, doc.elements.at(-1)!, opened));
    assert.ok(!isShown(doc, doc.elements.at(-1)!, toggleTrigger(opened, "card")));
  });

  test("a built page shows everything", () => {
    assert.equal(shownAt(builtState(doc)).length, doc.elements.length);
  });
});

describe("pageDocumentSchema", () => {
  test("takes a page with every kind of element and reveal", () => {
    const doc = { background: "#102030", elements: [newElement("text", "t"), el("b"), el("c", { on: "click", by: "b", effect: "wipe" })] };
    assert.ok(pageDocumentSchema.safeParse(doc).success);
  });

  test("refuses a repeated id, a reveal by an element not on the page, and one by the element itself", () => {
    const issue = (elements: PageElement[]) => pageDocumentSchema.safeParse({ background: "#ffffff", elements }).error?.issues[0]?.message;
    assert.equal(issue([el("a"), el("a")]), "repeats another element's id");
    assert.equal(issue([el("a", { on: "click", by: "nobody", effect: "fade" })]), "names no element on the page");
    assert.equal(issue([el("a", { on: "click", by: "a", effect: "fade" })]), "an element cannot reveal itself");
  });

  test("refuses a colour that is not #rrggbb", () => {
    assert.ok(!pageDocumentSchema.safeParse({ background: "red", elements: [] }).success);
  });
});

describe("revealGrid", () => {
  for (const count of [4, 6, 8] as const) {
    test(`${count} cards, each hiding one answer its click reveals, all on the stage`, () => {
      let n = 0;
      const elements = revealGrid(count, () => `e${n++}`);
      assert.ok(pageDocumentSchema.safeParse({ background: "#ffffff", elements }).success);
      const answers = elements.filter((e) => e.reveal?.on === "click");
      assert.equal(answers.length, count);
      assert.equal(new Set(answers.map((a) => (a.reveal as { by: string }).by)).size, count);
      for (const e of elements) {
        assert.ok(e.x >= 0 && e.y >= 0 && e.x + e.w <= 1920 && e.y + e.h <= 1080, `${e.text} is on the stage`);
      }
    });
  }
});

describe("snapBox", () => {
  test("snaps a dragged box's centre to the stage's centre, and says where", () => {
    const { box, guides } = snapBox({ x: 760 + SNAP - 2, y: 300, w: 400, h: 200 }, [], { x: "move", y: "move" });
    assert.equal(box.x, 760);
    assert.deepEqual(guides.x, [960]);
  });

  test("snaps a resized edge to another element's edge without moving the opposite one", () => {
    const { box } = snapBox({ x: 100, y: 100, w: 395, h: 100 }, [{ x: 500, y: 600, w: 100, h: 100 }], { x: "end", y: null });
    assert.deepEqual(box, { x: 100, y: 100, w: 400, h: 100 });
  });

  test("leaves a box alone when nothing is near", () => {
    const start = { x: 333, y: 333, w: 111, h: 111 };
    assert.deepEqual(snapBox(start, [], { x: "move", y: "move" }).box, start);
  });
});

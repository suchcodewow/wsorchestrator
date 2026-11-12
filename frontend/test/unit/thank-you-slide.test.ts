/**
 * The thank-you slide's layout and its round-photo links: the grid keeps every
 * judge's photo as large as it can, the 2X flame goes only on those who helped
 * twice, and a photo link is refused once altered, expired or aimed off Slack.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET ||= "test-secret";

import { breakoutGrid, breakoutRequests, gridFor, thankYouRequests, type BreakoutColumn, type SlideJudge } from "@/lib/google-slides";
import { photoLink, verifyPhotoLink } from "@/lib/logistics/thank-you-photo";

const judge = (i: number, times = 1): SlideJudge => ({ name: `Judge ${i}`, photoUrl: `https://x.test/${i}`, times });

describe("gridFor", () => {
  test("holds every judge and shrinks the photo as the count grows", () => {
    let last = Infinity;
    for (const n of [4, 12, 30, 60, 100]) {
      const g = gridFor(n);
      assert.ok(g.cols * g.rows >= n, `${n} fit`);
      assert.ok(g.photo > 0 && g.photo <= last, `${n} photo`);
      last = g.photo;
    }
  });
});

describe("thankYouRequests", () => {
  test("keeps the order given and flames only those who helped twice", () => {
    const reqs = thankYouRequests("starter", [judge(0), judge(1, 2), judge(2)]) as Record<
      string,
      { objectId?: string; text?: string } | undefined
    >[];
    const ids = reqs.map((r) => r.createImage?.objectId).filter(Boolean);
    assert.deepEqual(ids, ["photo_0", "photo_1", "photo_2"]);
    const flames = reqs.filter((r) => r.createShape?.objectId?.startsWith("flame_"));
    assert.deepEqual(
      flames.map((r) => r.createShape?.objectId),
      ["flame_1"],
    );
    assert.ok(reqs.some((r) => r.insertText?.text === "🔥 2X"));
  });
});

const column = (i: number, people: number, room: string | null = `Room ${i}`): BreakoutColumn => ({
  leader: `Leader ${i}`,
  room,
  people: Array.from({ length: people }, (_, p) => `Attendee ${i}.${p}`),
});

describe("breakoutGrid", () => {
  const boxes = (n: number, people: number) => Array.from({ length: n }, (_, i) => column(i, people));

  test("puts up to four instructors in one row and splits more evenly over two, never more than four across", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => breakoutGrid(boxes(n, 3)).rows),
      [1, 1, 1, 1, 2, 2, 2, 2],
    );
    assert.deepEqual(
      [5, 6, 7, 8].map((n) => breakoutGrid(boxes(n, 3)).cols),
      [3, 3, 4, 4],
    );
  });

  test("every card is as wide as one in a full row, and a short last row is centred", () => {
    const w = breakoutGrid(boxes(4, 3)).cardW;
    for (let n = 1; n <= 8; n++) assert.equal(breakoutGrid(boxes(n, 3)).cardW, w);
    const five = breakoutGrid(boxes(5, 3));
    assert.ok(five.xs[3] > five.xs[0], "the second row of two starts further right than the first row of three");
    const one = breakoutGrid(boxes(1, 3));
    assert.ok(Math.abs(one.xs[0] + one.cardW / 2 - 5) < 1e-9, "a lone card is in the middle of the page");
  });

  test("keeps every card on the page for one to eight instructors with big groups and long names", () => {
    for (let n = 1; n <= 8; n++) {
      for (const people of [0, 3, 10, 16]) {
        const cols = Array.from({ length: n }, (_, i) => ({
          leader: `Leader With A Long Name ${i}`,
          room: "A Very Long Room Name",
          people: Array.from({ length: people }, (_, p) => `Attendee With A Long Name ${i}.${p}`),
        }));
        const g = breakoutGrid(cols);
        const bottom = g.top + g.rows * g.cardH + (g.rows - 1) * 0.15;
        assert.ok(bottom <= 5.625 + 1e-9, `${n} x ${people}: bottom ${bottom}`);
        assert.ok(
          g.xs.every((x) => x >= 0.5 - 1e-9 && x + g.cardW <= 9.5 + 1e-9),
          `${n} x ${people}: across`,
        );
        assert.ok(g.top >= 0.95 - 1e-9, `${n} x ${people}: below the title`);
      }
    }
    assert.ok(breakoutGrid(boxes(1, 20)).leaderPt < breakoutGrid(boxes(1, 3)).leaderPt);
    assert.equal(breakoutGrid(boxes(1, 3)).leaderPt, 18);
  });
});

describe("breakoutRequests", () => {
  type Req = Record<string, { objectId?: string; text?: string } | undefined>;

  test("names the session, then gives each instructor a card with their room and group, in order, and no crown", () => {
    const reqs = (breakoutRequests("starter", "Breakout 1", [column(0, 2), column(1, 1, null)]) as unknown[]).flat() as Req[];
    const texts = reqs.filter((r) => r.insertText).map((r) => r.insertText!.text);
    assert.deepEqual(texts, ["Breakout 1", "Leader 0\nRoom 0\nAttendee 0.0\nAttendee 0.1", "Leader 1\nNo room\nAttendee 1.0"]);
    assert.ok(!JSON.stringify(reqs).includes("👑"));
    assert.deepEqual(
      reqs.filter((r) => r.createShape?.objectId?.startsWith("card_")).map((r) => r.createShape!.objectId),
      ["card_0", "card_1"],
    );
  });
});

describe("photo links", () => {
  const src = "https://avatars.slack-edge.com/a/b_192.jpg";
  const query = (link: string) => new URL(link).searchParams;

  test("a fresh link verifies", () => {
    assert.deepEqual(verifyPhotoLink(query(photoLink("https://app.test/", src, "orange"))), { src, ring: "orange" });
  });
  test("a changed ring or image is refused", () => {
    const q = query(photoLink("https://app.test", src, "blue"));
    q.set("ring", "orange");
    assert.equal(verifyPhotoLink(q), null);
    const r = query(photoLink("https://app.test", src, "blue"));
    r.set("src", "https://evil.test/x");
    assert.equal(verifyPhotoLink(r), null);
  });
  test("an expired link is refused", () => {
    const q = query(photoLink("https://app.test", src, "blue"));
    q.set("exp", "1");
    assert.equal(verifyPhotoLink(q), null);
  });
});

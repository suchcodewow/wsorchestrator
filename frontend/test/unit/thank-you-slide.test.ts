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
    assert.ok(reqs.some((r) => r.insertText?.text === "🔥2X"));
  });
});

const column = (i: number, people: number, room: string | null = `Room ${i}`): BreakoutColumn => ({
  leader: `Leader ${i}`,
  room,
  people: Array.from({ length: people }, (_, p) => `Attendee ${i}.${p}`),
});

describe("breakoutGrid", () => {
  test("puts up to five instructors in one row and wraps more onto two, with a font that shrinks as the groups grow", () => {
    assert.deepEqual(
      [1, 5, 6, 8].map((n) => breakoutGrid(Array.from({ length: n }, (_, i) => column(i, 3))).rows),
      [1, 1, 2, 2],
    );
    assert.ok(breakoutGrid([column(0, 20)]).fontPt < breakoutGrid([column(0, 3)]).fontPt);
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

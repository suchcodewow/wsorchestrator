/**
 * The concept map's pure parts: what an import must satisfy, the order and
 * levels worked out from it, where a video starts and how full its ring is,
 * where everything sits on the canvas, and what the map coach is told and how
 * its replies are read.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  COMPLETE_SHARE,
  END_SLACK_SECONDS,
  conceptsInOrder,
  mapContentSchema,
  publicMap,
  ringFraction,
  slideLevels,
  startAt,
} from "@/lib/mimir/map/schema";
import { CONCEPT_W, CONCEPT_Y, PAD, SLIDE_H, SLIDE_W, SLIDE_Y, layoutMap } from "@/lib/mimir/map/layout";
import {
  OPEN_REQUEST,
  buildCoachSystem,
  nextConcept,
  progressSnapshot,
  readCoachReply,
  turnContent,
  videoStatus,
  type SnapshotState,
} from "@/lib/mimir/map/coach-prompt";
import { mapFixture } from "../support/mimir-map";

const idsOf = (c: ReturnType<typeof mapFixture>) => new Set(c.concepts.map((k) => k.id));
const state = (over: Partial<SnapshotState> = {}): SnapshotState => ({ videoFurthest: 0, videoDuration: 0, completed: false, mastered: false, recommended: false, ...over });

describe("what an import must satisfy", () => {
  const issue = (over: Record<string, unknown>) => {
    const r = mapContentSchema.safeParse({ ...mapFixture(), ...over });
    return r.success ? null : r.error.issues[0]!;
  };

  test("a well-formed map is accepted", () => {
    assert.equal(mapFixture().concepts.length, 5);
  });

  test("a concept id may not repeat, nor sit in two groups, nor in none", () => {
    const f = mapFixture();
    assert.match(issue({ concepts: [...f.concepts, f.concepts[0]] })!.message, /duplicate concept alpha/);
    assert.match(issue({ buckets: [...f.buckets, { id: "g4", level: 1, name: "Again", blurb: "", concepts: ["alpha"] }] })!.message, /alpha is in two groups/);
    assert.match(issue({ buckets: f.buckets.slice(0, 2) })!.message, /delta is in no group/);
  });

  test("a group may only hold concepts that exist, and a concept only slides that exist", () => {
    const f = mapFixture();
    assert.match(issue({ buckets: [{ ...f.buckets[0], concepts: ["alpha", "beta", "nope"] }, ...f.buckets.slice(1)] })!.message, /unknown concept nope/);
    assert.match(issue({ concepts: [{ ...f.concepts[1], slides: [99] }, ...f.concepts.filter((c) => c.id !== "beta")] })!.message, /slide 99 does not exist/);
  });

  test("a video must live under the mimir/videos/ prefix, once", () => {
    const f = mapFixture();
    const withVideo = (object: string, id = "beta") => f.concepts.map((c) => (c.id === id ? { ...c, video: { object, seconds: 10, transcript: "t" } } : c));
    assert.ok(issue({ concepts: withVideo("files/x.mp4") }));
    assert.match(issue({ concepts: withVideo("mimir/videos/test-alpha.mp4") })!.message, /two videos at/);
    assert.equal(issue({ concepts: withVideo("mimir/videos/test-beta.mp4") }), null);
  });

  test("the lists are capped, so no read of one runs past a page of rows", () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ id: `c${i}`, name: "C", slides: [], explanation: "x" }));
    assert.ok(issue({ concepts: many, buckets: [{ id: "g", level: 1, name: "G", blurb: "", concepts: many.map((c) => c.id) }] }));
  });
});

describe("order and levels", () => {
  test("concepts are numbered in group order, each taking its group's level", () => {
    const order = conceptsInOrder(mapFixture());
    assert.deepEqual(order.map((c) => [c.id, c.study, c.level, c.bucket]), [
      ["alpha", 1, 1, "g1"],
      ["beta", 2, 1, "g1"],
      ["gamma", 3, 1, "g2"],
      ["delta", 4, 2, "g3"],
      ["omega", 5, 2, "g3"],
    ]);
  });

  test("a slide needs the highest level of any concept that uses it, and a slide none uses needs none", () => {
    const need = slideLevels(conceptsInOrder(mapFixture({ concepts: mapFixture().concepts.filter((c) => c.id !== "omega"), buckets: [{ id: "g1", level: 1, name: "G", blurb: "", concepts: ["alpha", "beta"] }, { id: "g2", level: 1, name: "G2", blurb: "", concepts: ["gamma"] }, { id: "g3", level: 2, name: "G3", blurb: "", concepts: ["delta"] }] })));
    assert.deepEqual(need, { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2 });
    assert.equal(need[6], undefined);
  });

  test("the page's copy of the map leaves out where a video is kept and what is said in it", () => {
    const pub = publicMap(mapFixture());
    const alpha = pub.concepts.find((c) => c.id === "alpha")!;
    assert.deepEqual(alpha.video, { seconds: 100 });
    assert.ok(!JSON.stringify(pub).includes("narrator"));
    assert.ok(!JSON.stringify(pub).includes("mimir/videos"));
  });
});

describe("where a video starts and how full its ring is", () => {
  test("it starts where they left off, or at the beginning when they never started or had reached the end", () => {
    assert.equal(startAt(0, 100), 0);
    assert.equal(startAt(42.5, 100), 42.5);
    assert.equal(startAt(100 - END_SLACK_SECONDS - 0.1, 100), 100 - END_SLACK_SECONDS - 0.1);
    assert.equal(startAt(100 - END_SLACK_SECONDS, 100), 0);
    assert.equal(startAt(100, 100), 0);
    assert.equal(startAt(50, 0), 0);
  });

  test("the ring fills with the furthest point reached, and is full once the video was finished", () => {
    assert.equal(ringFraction({ completed: false, videoFurthest: 25, videoDuration: 100 }, 80), 0.25);
    assert.equal(ringFraction({ completed: false, videoFurthest: 40, videoDuration: 0 }, 80), 0.5);
    assert.equal(ringFraction({ completed: false, videoFurthest: 500, videoDuration: 100 }, 80), 1);
    assert.equal(ringFraction({ completed: true, videoFurthest: 3, videoDuration: 100 }, 80), 1);
    assert.equal(ringFraction({ completed: false, videoFurthest: 0, videoDuration: 0 }, 0), 0);
    assert.ok(COMPLETE_SHARE > 0.9 && COMPLETE_SHARE < 1);
  });
});

describe("the canvas", () => {
  const layout = layoutMap(publicMap(mapFixture()));

  test("concepts run left to right in study order, with a wider gap between levels than between groups", () => {
    const xs = layout.concepts.map((c) => c.x);
    assert.deepEqual([...xs].sort((a, b) => a - b), xs);
    const gap = (i: number) => layout.concepts[i + 1]!.x - layout.concepts[i]!.x - CONCEPT_W;
    assert.equal(gap(0), 6); // same group
    assert.equal(gap(1), 16); // next group, same level
    assert.equal(gap(2), 30); // next level
  });

  test("the groups and levels cover exactly the concepts they hold", () => {
    assert.equal(layout.groups[0]!.x0, PAD);
    assert.equal(layout.levels.length, 2);
    assert.equal(layout.levels[0]!.x0, layout.groups[0]!.x0);
    assert.equal(layout.levels[1]!.x1, layout.groups.at(-1)!.x1);
    assert.equal(layout.width, layout.groups.at(-1)!.x1 + PAD);
  });

  test("every slide-to-concept link gets a curve from the slide's foot to the concept's head, inside both cards", () => {
    const expected = mapFixture().concepts.reduce((n, c) => n + c.slides.length, 0);
    assert.equal(layout.edges.length, expected);
    for (const e of layout.edges) {
      const m = /^M([\d.]+),([\d.]+) C[\d.]+,[\d.]+ [\d.]+,[\d.]+ ([\d.]+),([\d.]+)$/.exec(e.d);
      assert.ok(m, e.d);
      const [xa, ya, xb, yb] = m!.slice(1).map(Number) as [number, number, number, number];
      assert.equal(ya, SLIDE_Y + SLIDE_H);
      assert.equal(yb, CONCEPT_Y);
      assert.ok(Math.abs(xa - layout.slideX(e.slide)) <= SLIDE_W / 2);
      const c = layout.concepts.find((k) => k.id === e.concept)!;
      assert.ok(Math.abs(xb - c.x) <= CONCEPT_W / 2);
    }
  });

  test("slides are spread evenly across the canvas", () => {
    const step = layout.slideX(2) - layout.slideX(1);
    assert.ok(Math.abs(step - layout.slideSpacing) < 1e-9);
    assert.ok(layout.slideX(1) > PAD && layout.slideX(6) < layout.width - PAD);
  });
});

describe("what the map coach is told", () => {
  const content = mapFixture();

  test("the prompt carries the whole course, each concept's id, level and words, and each video's narration", () => {
    const p = buildCoachSystem(content, { name: "Pat", role: "AE", coachStyle: "socratic" }, { platformContext: "", namingGuard: "" });
    for (const c of content.concepts) assert.match(p, new RegExp(`\\[${c.id}\\] ${c.name}`));
    assert.match(p, /Study #1 · Level 100 · Group one/);
    assert.match(p, /Study #4 · Level 200 · Group three/);
    assert.match(p, /The narrator explains alpha with a bakery\./);
    assert.match(p, /No video for this concept yet\./);
    assert.match(p, /Rep context: Pat \(AE\)/);
  });

  test("it says how to open, check, recommend and mark, and the exact link the video recommendation uses", () => {
    const p = buildCoachSystem(content, { name: null, role: null, coachStyle: "socratic" }, { platformContext: "", namingGuard: "" });
    assert.match(p, /OPENING/);
    assert.match(p, /\[MASTERED: concept-id\]/);
    assert.match(p, /\[RECOMMEND: concept-id\]/);
    assert.match(p, /\[Watch: Concept name\]\(\/mimir\/map\?play=concept-id\)/);
    assert.match(p, /own level or earlier/);
  });

  test("a direct coach is told to be brief, and the platform and naming guards follow", () => {
    const direct = buildCoachSystem(content, { name: null, role: null, coachStyle: "direct" }, { platformContext: "PLATFORM-FACTS", namingGuard: "NAMING-GUARD" });
    assert.match(direct, /COACHING STYLE: Be concise/);
    assert.match(direct, /PLATFORM-FACTS/);
    assert.ok(direct.trimEnd().endsWith("NAMING-GUARD"));
    assert.doesNotMatch(buildCoachSystem(content, { name: null, role: null, coachStyle: "socratic" }, { platformContext: "", namingGuard: "" }), /COACHING STYLE: Be concise/);
  });

  test("the next concept is the lowest-numbered one not yet mastered, wherever the rep has been", () => {
    const order = conceptsInOrder(content);
    assert.equal(nextConcept(order, {})!.id, "alpha");
    assert.equal(nextConcept(order, { alpha: state({ mastered: true }) })!.id, "beta");
    assert.equal(nextConcept(order, { alpha: state({ mastered: true }), gamma: state({ mastered: true }) })!.id, "beta");
    assert.equal(nextConcept(order, Object.fromEntries(order.map((c) => [c.id, state({ mastered: true })]))), null);
  });

  test("the snapshot says what is mastered, what is next, and only what has any progress", () => {
    const s = progressSnapshot(content, { alpha: state({ mastered: true, completed: true }), gamma: state({ recommended: true, videoFurthest: 30, videoDuration: 60 }) });
    assert.match(s.text, /Mastered: 1 of 5\./);
    assert.match(s.text, /Next concept to cover: \[beta\] Beta/);
    assert.match(s.text, /\[alpha\] Alpha: mastered; video watched to the end/);
    assert.match(s.text, /\[gamma\] Gamma: recommended \(asked to watch the video\); video 50% watched/);
    assert.doesNotMatch(s.text, /\[delta\]|\[omega\]/);
    assert.match(progressSnapshot(content, {}).text, /No concept has any progress yet\./);
  });

  test("the snapshot's fingerprint changes when progress does, and only then", () => {
    const base = progressSnapshot(content, {});
    assert.equal(progressSnapshot(content, {}).hash, base.hash);
    assert.notEqual(progressSnapshot(content, { alpha: state({ videoFurthest: 10, videoDuration: 100 }) }).hash, base.hash);
    assert.notEqual(progressSnapshot(content, { alpha: state({ mastered: true }) }).hash, base.hash);
    assert.match(progressSnapshot(content, Object.fromEntries(conceptsInOrder(content).map((c) => [c.id, state({ mastered: true })]))).text, /Every concept is mastered\./);
  });

  test("a video's status reads in words", () => {
    const [alpha, beta] = conceptsInOrder(content);
    assert.equal(videoStatus(beta!, undefined), "no video");
    assert.equal(videoStatus(alpha!, undefined), "video not started");
    assert.equal(videoStatus(alpha!, state({ videoFurthest: 25, videoDuration: 100 })), "video 25% watched");
    assert.equal(videoStatus(alpha!, state({ completed: true })), "video watched to the end");
  });

  test("a turn carries the snapshot first only when there is one to send", () => {
    const s = progressSnapshot(content, {});
    assert.equal(turnContent("hello", null), "hello");
    assert.ok(turnContent("hello", s).startsWith("<progress>\nPROGRESS SNAPSHOT"));
    assert.ok(turnContent(OPEN_REQUEST, s).endsWith(OPEN_REQUEST));
  });
});

describe("what a reply asks the app to do", () => {
  const ids = idsOf(mapFixture());

  test("a marker on its own line takes effect and is not shown", () => {
    const r = readCoachReply("That covers it.\n\nNext up: Beta. What do you know?\n[MASTERED: alpha]", ids);
    assert.deepEqual(r.mastered, ["alpha"]);
    assert.deepEqual(r.recommended, []);
    assert.equal(r.text, "That covers it.\n\nNext up: Beta. What do you know?");
  });

  test("a recommendation is read the same way, in any case and with spacing", () => {
    const r = readCoachReply("Watch it first: [Watch: Gamma](/mimir/map?play=gamma)\n  [recommend:  gamma ]  ", ids);
    assert.deepEqual(r.recommended, ["gamma"]);
    assert.ok(r.text.includes("[Watch: Gamma](/mimir/map?play=gamma)"));
    assert.ok(!/recommend/i.test(r.text));
  });

  test("a marker for a concept that is not in the course does nothing, and is still hidden", () => {
    const r = readCoachReply("Fine.\n[MASTERED: nonsense]", ids);
    assert.deepEqual(r.mastered, []);
    assert.equal(r.text, "Fine.");
  });

  test("a marker in the middle of a sentence is hidden but does not count", () => {
    const r = readCoachReply("I would say [MASTERED: alpha] here, honestly.", ids);
    assert.deepEqual(r.mastered, []);
    assert.equal(r.text, "I would say  here, honestly.");
  });

  test("at most one of each takes effect, and mastered wins over recommended for the same concept", () => {
    const r = readCoachReply("Ok.\n[MASTERED: alpha]\n[MASTERED: beta]\n[RECOMMEND: alpha]\n[RECOMMEND: gamma]", ids);
    assert.deepEqual(r.mastered, ["alpha"]);
    assert.deepEqual(r.recommended, ["gamma"]);
  });

  test("a reply with no marker is just its text", () => {
    assert.deepEqual(readCoachReply("Tell me more.", ids), { text: "Tell me more.", mastered: [], recommended: [] });
  });
});

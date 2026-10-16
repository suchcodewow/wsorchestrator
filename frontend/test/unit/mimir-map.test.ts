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
  POINT_CHARS,
  checklistOf,
  conceptsInOrder,
  mapContentSchema,
  publicMap,
  ringFraction,
  slideLevels,
  startAt,
} from "@/lib/mimir/map/schema";
import { parseSlideNumber, slideObject } from "@/lib/mimir/map/slides";
import { CONCEPT_W, CONCEPT_Y, PAD, SLIDE_H, SLIDE_W, SLIDE_Y, layoutMap } from "@/lib/mimir/map/layout";
import {
  OPEN_REQUEST,
  buildCoachSystem,
  knowsChecklists,
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

  test("a concept's own main points number two to six, each short", () => {
    const f = mapFixture();
    const withPoints = (points: unknown) => f.concepts.map((c) => (c.id === "beta" ? { ...c, points } : c));
    assert.equal(issue({ concepts: withPoints(["One idea", "Another idea"]) }), null);
    assert.ok(issue({ concepts: withPoints(["Only one"]) }));
    assert.ok(issue({ concepts: withPoints(Array.from({ length: 7 }, (_, i) => `Point ${i}`)) }));
    assert.ok(issue({ concepts: withPoints(["Fine", "x".repeat(POINT_CHARS + 1)]) }));
    assert.ok(issue({ concepts: withPoints(["Fine", ""]) }));
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
    assert.deepEqual(need, { 1: 1, 2: 1, 3: 2, 4: 2, 5: 2 });
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

  test("the groups and levels cover exactly the concepts they hold, centred in the canvas", () => {
    const first = layout.groups[0]!;
    const last = layout.groups.at(-1)!;
    assert.ok(first.x0 >= PAD && last.x1 + PAD <= layout.width);
    assert.ok(Math.abs(first.x0 - (layout.width - last.x1)) < 1e-9, "equal margins either side");
    assert.equal(layout.levels.length, 2);
    assert.equal(layout.levels[0]!.x0, first.x0);
    assert.equal(layout.levels[1]!.x1, last.x1);
    assert.deepEqual(layout.groups.map((g) => g.concepts.length), [2, 1, 2]);
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

  test("the bands cover the slides of each section, and say which", () => {
    assert.deepEqual(layout.bands.map((b) => [b.name, b.from, b.to, b.count]), [["First half", 1, 3, 3], ["Second half", 4, 6, 3]]);
    assert.equal(layout.bands[0]!.left, PAD + 1);
  });

  test("slides are spread evenly across the canvas", () => {
    const step = layout.slideX(2) - layout.slideX(1);
    assert.ok(Math.abs(step - layout.slideSpacing) < 1e-9);
    assert.ok(layout.slideX(1) > PAD && layout.slideX(6) < layout.width - PAD);
  });
});

describe("the canvas filtered to one level", () => {
  const pub = publicMap(mapFixture());
  const everything = layoutMap(pub);
  const basics = layoutMap(pub, 1);
  const more = layoutMap(pub, 2);

  test("only that level's concepts, groups and level bar are laid out, numbered as in the whole course", () => {
    assert.deepEqual(basics.concepts.map((c) => [c.id, c.study]), [["alpha", 1], ["beta", 2], ["gamma", 3]]);
    assert.deepEqual(basics.groups.map((g) => g.id), ["g1", "g2"]);
    assert.deepEqual(basics.levels.map((l) => l.level), [1]);
    assert.deepEqual(more.concepts.map((c) => [c.id, c.study]), [["delta", 4], ["omega", 5]]);
    assert.deepEqual(more.levels.map((l) => l.level), [2]);
  });

  test("only the slides that need those concepts are shown, in order", () => {
    assert.deepEqual(everything.slides, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(basics.slides, [1, 2, 3]);
    assert.deepEqual(more.slides, [3, 4, 5, 6]);
  });

  test("a slide keeps the level it needs across the whole course, not just among what is shown", () => {
    assert.equal(basics.need[3], 2);
    assert.equal(more.need[3], 2);
    assert.deepEqual(basics.need, everything.need);
  });

  test("only lines between what is shown remain", () => {
    assert.deepEqual([...new Set(basics.edges.map((e) => e.concept))].sort(), ["alpha", "beta", "gamma"]);
    assert.equal(basics.edges.length, 2 + 2 + 1);
    assert.ok(more.edges.every((e) => more.slides.includes(e.slide)));
  });

  test("the bands cover only the sections that still have a slide, counted among those shown", () => {
    assert.deepEqual(basics.bands.map((b) => [b.name, b.count]), [["First half", 3]]);
    assert.deepEqual(more.bands.map((b) => [b.name, b.count]), [["First half", 1], ["Second half", 3]]);
  });

  test("slides never overlap, even when a few concepts leave many slides to place; the concepts are centred", () => {
    for (const l of [everything, basics, more]) assert.ok(l.slideSpacing >= SLIDE_W + 6 - 1e-9);
    const centre = (more.groups[0]!.x0 + more.groups.at(-1)!.x1) / 2;
    assert.ok(Math.abs(centre - more.width / 2) < 1e-9);
    assert.ok(more.width > more.groups.at(-1)!.x1 + PAD);
  });

  test("a level with nothing in it leaves an empty map rather than failing", () => {
    const empty = layoutMap({ ...pub, buckets: pub.buckets.filter((b) => b.level === 1), concepts: pub.concepts.filter((c) => ["alpha", "beta", "gamma"].includes(c.id)) }, 2);
    assert.deepEqual([empty.concepts.length, empty.slides.length, empty.edges.length], [0, 0, 0]);
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

  test("it is told to tick points one at a time, never to ask for the lot again, and to be lenient about wording", () => {
    const p = buildCoachSystem(content, { name: null, role: null, coachStyle: "socratic" }, { platformContext: "", namingGuard: "" });
    assert.match(p, /\[POINTS: concept-id \| /);
    assert.match(p, /\[COVERED: concept-id 1 3\]/);
    assert.match(p, /THE CHECKLIST/);
    assert.ok(knowsChecklists(p));
    assert.equal(knowsChecklists("An old prompt that only knew [MASTERED: concept-id]."), false);
  });

  test("a concept's own main points are in the prompt as its checklist", () => {
    const authored = mapFixture({ concepts: mapFixture().concepts.map((c) => (c.id === "beta" ? { ...c, points: ["Beta saves time", "Beta needs alpha"] } : c)) });
    const p = buildCoachSystem(authored, { name: null, role: null, coachStyle: "socratic" }, { platformContext: "", namingGuard: "" });
    assert.match(p, /Main points \(its checklist\):\n1\. Beta saves time\n2\. Beta needs alpha/);
    assert.equal((p.match(/Main points \(its checklist\)/g) ?? []).length, 1);
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

  test("the snapshot lists the next concept's checklist, which points are covered and which are open", () => {
    assert.match(progressSnapshot(content, {}).text, /Checklist for \[alpha\] Alpha: none yet\. Write one with \[POINTS\]/);
    const points = [
      { text: "Alpha is first", covered: true },
      { text: "Alpha is a bakery", covered: false },
    ];
    const s = progressSnapshot(content, { alpha: state({ points }) });
    assert.match(s.text, /\[alpha\] Alpha: 1 of 2 points covered/);
    assert.match(s.text, /Checklist for \[alpha\] Alpha \(1 of 2 covered; ask only about open points\):\n  1\. \[covered\] Alpha is first\n  2\. \[open\] Alpha is a bakery/);
    assert.doesNotMatch(s.text, /Checklist for \[beta\]/);
  });

  test("a concept started on keeps its checklist in the snapshot after the rep moves past it", () => {
    const s = progressSnapshot(content, { alpha: state({ mastered: true }), gamma: state({ points: [{ text: "G one", covered: true }, { text: "G two", covered: false }] }) });
    assert.match(s.text, /Checklist for \[beta\] Beta: none yet/);
    assert.match(s.text, /Checklist for \[gamma\] Gamma \(1 of 2 covered/);
    assert.doesNotMatch(s.text, /Checklist for \[alpha\]/);
  });

  test("a tick changes the snapshot's fingerprint, so the coach is told", () => {
    const open = [
      { text: "One", covered: false },
      { text: "Two", covered: false },
    ];
    const before = progressSnapshot(content, { alpha: state({ points: open }) });
    const after = progressSnapshot(content, { alpha: state({ points: [{ ...open[0]!, covered: true }, open[1]!] }) });
    assert.notEqual(after.hash, before.hash);
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
    assert.deepEqual(readCoachReply("Tell me more.", ids), { text: "Tell me more.", mastered: [], recommended: [], checklists: [], covered: [] });
  });

  test("a checklist and a tick are read together and neither is shown", () => {
    const r = readCoachReply("Good, that's the first one. What does beta need?\n[POINTS: beta | Beta saves time | Beta needs alpha |  ]\n[COVERED: beta 1]", ids);
    assert.deepEqual(r.checklists, [{ id: "beta", points: ["Beta saves time", "Beta needs alpha"] }]);
    assert.deepEqual(r.covered, [{ id: "beta", points: [1] }]);
    assert.equal(r.text, "Good, that's the first one. What does beta need?");
  });

  test("a checklist of one point does not count, a long one is cut to six, and a long point is cut short", () => {
    assert.deepEqual(readCoachReply("Ok.\n[POINTS: beta | Just one]", ids).checklists, []);
    const many = readCoachReply(`Ok.\n[POINTS: beta | ${Array.from({ length: 8 }, (_, i) => `P${i + 1}`).join(" | ")}]`, ids).checklists[0]!;
    assert.deepEqual(many.points, ["P1", "P2", "P3", "P4", "P5", "P6"]);
    const long = readCoachReply(`Ok.\n[POINTS: beta | ${"y".repeat(400)} | Short]`, ids).checklists[0]!;
    assert.equal(long.points[0]!.length, POINT_CHARS);
  });

  test("ticks are numbers from one to six, each once, in order, with commas or spaces", () => {
    assert.deepEqual(readCoachReply("Ok.\n[COVERED: alpha 3, 1 3  9 0]", ids).covered, [{ id: "alpha", points: [1, 3] }]);
    assert.deepEqual(readCoachReply("Ok.\n[COVERED: alpha 0 7]", ids).covered, []);
    assert.deepEqual(readCoachReply("Ok.\n[COVERED: nonsense 1]", ids).covered, []);
    assert.deepEqual(readCoachReply("Ok.\n[COVERED: alpha 1]\n[COVERED: beta 2]", ids).covered, [{ id: "alpha", points: [1] }]);
  });

  test("a tick in the middle of a sentence is hidden but does not count", () => {
    const r = readCoachReply("You got [COVERED: alpha 1] that one.", ids);
    assert.deepEqual(r.covered, []);
    assert.equal(r.text, "You got  that one.");
  });
});

describe("a concept's checklist", () => {
  const stored = [
    { text: "Kept wording", covered: true },
    { text: "Old wording", covered: true },
  ];

  test("a concept's own points win, and a tick carries over to a point whose wording is unchanged", () => {
    assert.deepEqual(checklistOf({ points: ["Kept wording", "New wording"] }, stored), [
      { text: "Kept wording", covered: true },
      { text: "New wording", covered: false },
    ]);
  });

  test("without its own points, the one the coach set out is used, and none means none yet", () => {
    assert.deepEqual(checklistOf({}, stored), stored);
    assert.equal(checklistOf({}, null), null);
    assert.equal(checklistOf({}, []), null);
    assert.deepEqual(checklistOf({ points: ["A", "B"] }, null), [
      { text: "A", covered: false },
      { text: "B", covered: false },
    ]);
  });
});

describe("a slide's picture", () => {
  test("lives at mimir/slides/<n>.jpg, clear of the video prefix", () => {
    assert.equal(slideObject(7), "mimir/slides/7.jpg");
  });

  test("takes only a whole slide number in range from the address", () => {
    assert.equal(parseSlideNumber("1"), 1);
    assert.equal(parseSlideNumber("46"), 46);
    assert.equal(parseSlideNumber("200"), 200);
    for (const bad of ["0", "201", "-1", "01", "1.5", "1e2", "abc", "", "../1", "1%2F2", "99999"]) assert.equal(parseSlideNumber(bad), null, bad);
  });
});

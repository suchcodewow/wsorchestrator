/**
 * The concept map against a real database: the imported content, each
 * person's progress through the videos, what the coach marks, and the
 * coach's conversation — what it is sent, what is kept, what a failed or
 * overlapping send leaves behind. Claude is never called: every send passes
 * its own stand-in for it.
 *
 * Everyone here is a test account, so cleanup finds them and their rows go
 * with them. The map is one row for the whole database, so the suite clears it.
 */

import "../support/test-env";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { mimirCoachConversations, mimirCoachMessages, mimirCoachStats, mimirConceptProgress, mimirMap } from "@/db/schema";
import { MIMIR_CONTEXT_LIMIT, type Complete, type CompletionRequest } from "@/lib/mimir/chat";
import { getMap, importMap } from "@/lib/mimir/map/content";
import { GREET_AFTER_MS, beginCoachTurn, getCoachChat, resetCoachChat, sendCoachMessage } from "@/lib/mimir/map/coach";
import { getConceptState, listConceptStates, markMastered, markRecommended, saveVideoProgress } from "@/lib/mimir/map/progress";
import { MAP_ID } from "@/lib/mimir/map/schema";
import { countNewConversation } from "@/lib/mimir/map/stats";
import { mapSummary } from "@/lib/mimir/map/summary";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";
import { mapFixture } from "../support/mimir-map";

const scope = testScope("mimirmap");

let admin: TestUser;
let rep: TestUser;
let other: TestUser;

/** A stand-in for Claude that records what it was sent and answers with `reply`. */
function coach(reply: string, stopReason = "end_turn") {
  const sent: CompletionRequest[] = [];
  const complete: Complete = async (req, stream) => {
    sent.push(structuredClone(req));
    for (const word of reply.split(/(?<= )/)) stream?.text(word);
    return {
      content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: reply }],
      text: reply,
      stopReason,
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  };
  return { complete, sent };
}

const messagesOf = (userId: string) => db.select().from(mimirCoachMessages).where(eq(mimirCoachMessages.userId, userId)).orderBy(mimirCoachMessages.seq);
const lastUserContent = (c: CompletionRequest) => String(c.messages.filter((m) => m.role === "user").at(-1)!.content);

const savedKey = process.env.ANTHROPIC_API_KEY;
before(async () => {
  await scope.setUp();
  admin = await scope.createUser("admin", PERSONAS.trainingAdmin);
  rep = await scope.createUser("rep", PERSONAS.nobody);
  other = await scope.createUser("other", PERSONAS.nobody);
  // The page only offers a greeting when the server has a Claude key; the stand-in needs none.
  process.env.ANTHROPIC_API_KEY ||= "test-key";
  await importMap(admin.id, mapFixture());
});

after(async () => {
  await db.delete(mimirMap).where(eq(mimirMap.id, MAP_ID));
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  await scope.tearDown();
});

describe("the map's content", () => {
  test("an import is read back as it was, and a second import replaces it whole", async () => {
    const first = await getMap();
    assert.equal(first?.content.title, "Test map");
    assert.equal(first?.content.concepts.length, 5);
    await importMap(admin.id, mapFixture({ title: "Renamed map" }));
    assert.equal((await getMap())?.content.title, "Renamed map");
    await importMap(admin.id, mapFixture());
  });

  test("a stored map that no longer fits the schema reads as no map, rather than reaching the page", async () => {
    await db.update(mimirMap).set({ content: { version: 1, nonsense: true } }).where(eq(mimirMap.id, MAP_ID));
    assert.equal(await getMap(), null);
    await importMap(admin.id, mapFixture());
    assert.ok(await getMap());
  });
});

describe("progress through a video", () => {
  test("it resumes where they left off, and remembers the furthest they got", async () => {
    let s = await saveVideoProgress(rep.id, "alpha", { position: 60, duration: 100, ended: false });
    assert.deepEqual([s.videoSeconds, s.videoFurthest, s.completed, s.resumeAt], [60, 60, false, 60]);
    await saveVideoProgress(rep.id, "alpha", { position: 80, duration: 100, ended: false });
    s = await saveVideoProgress(rep.id, "alpha", { position: 20, duration: 100, ended: false });
    assert.deepEqual([s.videoSeconds, s.videoFurthest, s.resumeAt], [20, 80, 20]);
    assert.equal((await getConceptState(rep.id, "alpha")).resumeAt, 20);
  });

  test("reaching the end finishes it, starts the next play over, and is kept when they watch again", async () => {
    let s = await saveVideoProgress(rep.id, "gamma", { position: 60, duration: 60, ended: true });
    assert.deepEqual([s.completed, s.videoFurthest, s.resumeAt], [true, 60, 0]);
    s = await saveVideoProgress(rep.id, "gamma", { position: 15, duration: 60, ended: false });
    assert.deepEqual([s.completed, s.resumeAt, s.videoFurthest], [true, 15, 60]);
  });

  test("stopping in the last few seconds counts as the end, and the last 5% as finished", async () => {
    let s = await saveVideoProgress(other.id, "alpha", { position: 98, duration: 100, ended: false });
    assert.deepEqual([s.completed, s.resumeAt], [true, 0]);
    s = await saveVideoProgress(other.id, "gamma", { position: 40, duration: 60, ended: false });
    assert.deepEqual([s.completed, s.resumeAt], [false, 40]);
  });

  test("a position past the end is held at the end, and a negative one at the start", async () => {
    assert.equal((await saveVideoProgress(other.id, "gamma", { position: 500, duration: 60, ended: false })).videoSeconds, 60);
    assert.equal((await saveVideoProgress(other.id, "gamma", { position: -5, duration: 60, ended: false })).videoSeconds, 0);
  });

  test("everyone's progress is their own", async () => {
    const mine = await listConceptStates(rep.id);
    const theirs = await listConceptStates(other.id);
    assert.deepEqual(Object.keys(mine).sort(), ["alpha", "gamma"]);
    assert.equal(mine.alpha!.videoSeconds, 20);
    assert.equal(theirs.alpha!.videoSeconds, 98);
    assert.deepEqual(await listConceptStates(admin.id), {});
  });
});

describe("what the coach marks", () => {
  test("a recommendation stands until the concept is mastered, which clears it", async () => {
    await markRecommended(rep.id, "beta");
    assert.equal((await getConceptState(rep.id, "beta")).recommended, true);
    await markMastered(rep.id, "beta");
    const s = await getConceptState(rep.id, "beta");
    assert.deepEqual([s.mastered, s.recommended], [true, false]);
  });

  test("a mastered concept is not recommended afterwards", async () => {
    await markRecommended(rep.id, "beta");
    const s = await getConceptState(rep.id, "beta");
    assert.deepEqual([s.mastered, s.recommended], [true, false]);
  });

  test("marking a concept keeps its video progress", async () => {
    await markMastered(rep.id, "alpha");
    const s = await getConceptState(rep.id, "alpha");
    assert.deepEqual([s.mastered, s.videoSeconds, s.videoFurthest], [true, 20, 80]);
  });

  test("the summary counts what they have mastered and watched, and names the next concept", async () => {
    assert.deepEqual(await mapSummary(rep.id), { total: 5, mastered: 2, watched: 1, withVideo: 2, next: { id: "gamma", name: "Gamma" } });
    assert.deepEqual(await mapSummary(admin.id), { total: 5, mastered: 0, watched: 0, withVideo: 2, next: { id: "alpha", name: "Alpha" } });
  });
});

describe("the coach", () => {
  // Each test starts with no conversation and no progress for the two reps.
  beforeEach(async () => {
    for (const u of [rep, other]) {
      await resetCoachChat(u.id);
      await db.delete(mimirConceptProgress).where(eq(mimirConceptProgress.userId, u.id));
    }
  });


  test("opening it greets them: the course is the system prompt, and they are handed where they stand", async () => {
    const view = await getCoachChat(rep.id);
    assert.deepEqual([view.hasMap, view.conversation, view.needsGreeting, view.progress.mastered, view.progress.next?.id], [true, null, true, 0, "alpha"]);

    const c = coach("Hello Pat, shall we start with Alpha?");
    const result = await sendCoachMessage(rep.id, { open: true }, { complete: c.complete });
    assert.ok(result.ok);
    assert.deepEqual(result.messages.map((m) => m.role), ["assistant"]);

    const req = c.sent[0]!;
    assert.match(req.system, /\[alpha\] Alpha/);
    assert.match(req.system, /The narrator explains gamma\./);
    const opener = lastUserContent(req);
    assert.match(opener, /^<progress>\nPROGRESS SNAPSHOT/);
    assert.match(opener, /Next concept to cover: \[alpha\] Alpha/);
    assert.ok(opener.endsWith("I just opened Mimir. Introduce yourself."));
  });

  test("it introduces itself on the first opening and every fourth one after", async () => {
    const asked: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const c = coach("Hello.");
      await sendCoachMessage(rep.id, { open: true }, { complete: c.complete });
      asked.push(/Introduce yourself\.$/.test(lastUserContent(c.sent[0]!)));
    }
    assert.deepEqual(asked, [true, false, false, false, true]);
  });

  test("the greeting is not shown as something they said", async () => {
    await sendCoachMessage(rep.id, { open: true }, { complete: coach("Hello.").complete });
    const stored = await messagesOf(rep.id);
    assert.deepEqual(stored.map((m) => [m.role, m.shown]), [["user", false], ["assistant", true]]);
    const view = await getCoachChat(rep.id);
    assert.deepEqual(view.conversation!.messages.map((m) => m.role), ["assistant"]);
    assert.equal(view.needsGreeting, false);
  });

  test("a marker in the reply marks the concept and is not shown, and the next concept moves on", async () => {
    const c = coach("That covers it. Next: Beta. What do you know about it?\n[MASTERED: alpha]");
    const result = await sendCoachMessage(rep.id, { message: "It is the first thing." }, { complete: c.complete });
    assert.ok(result.ok);
    assert.deepEqual(result.mastered, ["alpha"]);
    assert.equal(result.progress.mastered, 1);
    assert.equal(result.progress.next?.id, "beta");
    assert.ok(!result.messages.some((m) => m.text.includes("MASTERED")));
    assert.equal((await getConceptState(rep.id, "alpha")).mastered, true);
    assert.ok(!(await messagesOf(rep.id)).some((m) => m.role === "assistant" && m.text.includes("MASTERED")));
  });

  test("a recommendation flags the concept, a later mastery clears it, and the coach is not re-greeted for its own changes", async () => {
    const rec = await sendCoachMessage(rep.id, { message: "No idea." }, { complete: coach("Watch it: [Watch: Gamma](/mimir/map?play=gamma)\n[RECOMMEND: gamma]").complete });
    assert.ok(rec.ok && rec.recommended[0] === "gamma");
    assert.equal((await getConceptState(rep.id, "gamma")).recommended, true);
    assert.equal((await getCoachChat(rep.id)).needsGreeting, false);

    await sendCoachMessage(rep.id, { message: "Now I know." }, { complete: coach("Yes.\n[MASTERED: gamma]").complete });
    const s = await getConceptState(rep.id, "gamma");
    assert.deepEqual([s.mastered, s.recommended], [true, false]);
  });

  test("the snapshot goes again only once their progress has moved, and a reply cannot mark a concept outside the course", async () => {
    const c = coach("Ok.\n[MASTERED: nonsense]");
    await sendCoachMessage(rep.id, { open: true }, { complete: c.complete });
    await sendCoachMessage(rep.id, { message: "First." }, { complete: c.complete });
    assert.doesNotMatch(lastUserContent(c.sent[1]!), /<progress>/);
    assert.deepEqual(await listConceptStates(rep.id), {});

    await saveVideoProgress(rep.id, "alpha", { position: 50, duration: 100, ended: false });
    await sendCoachMessage(rep.id, { message: "Second." }, { complete: c.complete });
    assert.match(lastUserContent(c.sent[2]!), /<progress>[\s\S]*video 50% watched[\s\S]*<\/progress>\n\nSecond\./);
    await sendCoachMessage(rep.id, { message: "Third." }, { complete: c.complete });
    assert.doesNotMatch(lastUserContent(c.sent[3]!), /<progress>/);
  });

  test("it offers to greet again after a video, and after a long gap, but not otherwise", async () => {
    await sendCoachMessage(rep.id, { open: true }, { complete: coach("Hi.").complete });
    assert.equal((await getCoachChat(rep.id)).needsGreeting, false);
    await saveVideoProgress(rep.id, "gamma", { position: 60, duration: 60, ended: true });
    assert.equal((await getCoachChat(rep.id)).needsGreeting, true);
    await sendCoachMessage(rep.id, { open: true }, { complete: coach("Welcome back.").complete });
    assert.equal((await getCoachChat(rep.id)).needsGreeting, false);
    await db.update(mimirCoachConversations).set({ updatedAt: new Date(Date.now() - GREET_AFTER_MS - 60_000) }).where(eq(mimirCoachConversations.userId, rep.id));
    assert.equal((await getCoachChat(rep.id)).needsGreeting, true);
  });

  test("a reply that fails or is declined takes their message back out", async () => {
    await sendCoachMessage(rep.id, { open: true }, { complete: coach("Hi.").complete });
    const before = (await messagesOf(rep.id)).length;
    const broke: Complete = async () => {
      throw new Error("down");
    };
    assert.deepEqual(await sendCoachMessage(rep.id, { message: "Lost?" }, { complete: broke }), { ok: false, error: "upstream" });
    assert.deepEqual(await sendCoachMessage(rep.id, { message: "Declined?" }, { complete: coach("no", "refusal").complete }), { ok: false, error: "refused" });
    assert.deepEqual(await sendCoachMessage(rep.id, { message: "Only a marker?" }, { complete: coach("[MASTERED: alpha]").complete }), { ok: false, error: "upstream" });
    assert.equal((await messagesOf(rep.id)).length, before);
    assert.deepEqual(await listConceptStates(rep.id), {});
  });

  test("a second send while the coach is still replying is refused as busy", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Complete = async () => {
      await gate;
      return { content: [{ type: "text", text: "Done." }], text: "Done.", stopReason: "end_turn", usage: {} };
    };
    const first = sendCoachMessage(rep.id, { message: "First." }, { complete: slow });
    for (let i = 0; i < 50 && (await messagesOf(rep.id)).at(-1)?.text !== "First."; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(await sendCoachMessage(rep.id, { message: "Second." }, { complete: coach("x").complete }), { ok: false, error: "busy" });
    release();
    assert.ok((await first).ok);
  });

  test("a conversation as long as the model can read is full, and a new one starts afresh", async () => {
    await sendCoachMessage(rep.id, { open: true }, { complete: coach("Hi.").complete });
    const last = (await messagesOf(rep.id)).at(-1)!;
    await db.update(mimirCoachMessages).set({ usage: { input_tokens: MIMIR_CONTEXT_LIMIT } }).where(eq(mimirCoachMessages.userId, rep.id));
    assert.equal(last.role, "assistant");
    assert.deepEqual(await sendCoachMessage(rep.id, { message: "More?" }, { complete: coach("x").complete }), { ok: false, error: "full" });
    assert.equal(await resetCoachChat(rep.id), true);
    assert.ok((await sendCoachMessage(rep.id, { message: "Fresh." }, { complete: coach("Ok.").complete })).ok);
  });

  test("the course is fixed when a conversation starts, and a new conversation reads it as it now is", async () => {
    const c = coach("Ok.");
    await sendCoachMessage(rep.id, { open: true }, { complete: c.complete });
    const renamed = mapFixture();
    renamed.concepts[0]!.name = "Alpha Prime";
    await importMap(admin.id, renamed);
    await sendCoachMessage(rep.id, { message: "Hello." }, { complete: c.complete });
    assert.match(c.sent[1]!.system, /\[alpha\] Alpha\n/);
    assert.doesNotMatch(c.sent[1]!.system, /Alpha Prime/);

    await resetCoachChat(rep.id);
    await sendCoachMessage(rep.id, { open: true }, { complete: c.complete });
    assert.match(c.sent[2]!.system, /\[alpha\] Alpha Prime/);
    await importMap(admin.id, mapFixture());
  });

  test("the coach keeps count of what they type, their best mastery, and new conversations, across starting over", async () => {
    const statsOf = async (id: string) => (await db.select().from(mimirCoachStats).where(eq(mimirCoachStats.userId, id)))[0];
    await db.delete(mimirCoachStats).where(eq(mimirCoachStats.userId, rep.id));

    await sendCoachMessage(rep.id, { open: true }, { complete: coach("Welcome.").complete });
    await sendCoachMessage(rep.id, { message: "Hi." }, { complete: coach("Good.\n[MASTERED: alpha]").complete });
    await sendCoachMessage(rep.id, { message: "More." }, { complete: coach("Ok.").complete });
    let stats = await statsOf(rep.id);
    assert.equal(stats?.messagesSent, 2, "a greeting is not something they typed");
    assert.equal(stats?.peakMastered, 1);
    assert.equal(stats?.newConversations, 0);

    await countNewConversation(rep.id);
    await resetCoachChat(rep.id);
    await sendCoachMessage(rep.id, { message: "Again." }, { complete: coach("Fine.").complete });
    stats = await statsOf(rep.id);
    assert.equal(stats?.messagesSent, 3);
    assert.equal(stats?.peakMastered, 1, "a new conversation does not lower the best");
    assert.equal(stats?.newConversations, 1);

    await db.delete(mimirConceptProgress).where(eq(mimirConceptProgress.userId, rep.id));
    await sendCoachMessage(rep.id, { message: "Back to none." }, { complete: coach("Ok.").complete });
    assert.equal((await statsOf(rep.id))?.peakMastered, 1, "losing progress does not lower it either");
  });

  test("starting over throws the conversation away but keeps their progress", async () => {
    await sendCoachMessage(rep.id, { message: "Hi." }, { complete: coach("Good.\n[MASTERED: alpha]").complete });
    assert.equal(await resetCoachChat(rep.id), true);
    assert.equal(await resetCoachChat(rep.id), false);
    assert.equal((await messagesOf(rep.id)).length, 0);
    assert.equal((await getConceptState(rep.id, "alpha")).mastered, true);
  });

  test("the page shows the latest turns and says when older ones come before them", async () => {
    const c = coach("Reply.");
    for (let i = 0; i < 3; i++) await sendCoachMessage(rep.id, { message: `Message ${i}` }, { complete: c.complete });
    const view = await getCoachChat(rep.id);
    const shown = view.conversation!.messages;
    assert.deepEqual(shown.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant"]);
    assert.ok(shown.every((m, i) => i === 0 || m.seq > shown[i - 1]!.seq));
    assert.ok(shown.filter((m) => m.role === "assistant").every((m) => typeof m.html === "string"));
    assert.equal(view.conversation!.earlier, false);
    const older = await getCoachChat(rep.id, shown[3]!.seq);
    assert.deepEqual(older.conversation!.messages.map((m) => m.seq), shown.slice(0, 3).map((m) => m.seq));
  });

  test("without a map there is nothing to coach on", async () => {
    await db.delete(mimirMap).where(eq(mimirMap.id, MAP_ID));
    assert.deepEqual(await sendCoachMessage(rep.id, { open: true }, { complete: coach("x").complete }), { ok: false, error: "no_map" });
    const view = await getCoachChat(rep.id);
    assert.deepEqual([view.hasMap, view.needsGreeting, view.conversation], [false, false, null]);
    assert.equal(await mapSummary(rep.id), null);
    await importMap(admin.id, mapFixture());
  });

  test("it will not reply without a Claude key", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      assert.deepEqual(await beginCoachTurn(rep.id, { message: "Hi" }), { ok: false, error: "not_configured" });
      assert.equal((await getCoachChat(rep.id)).needsGreeting, false);
    } finally {
      process.env.ANTHROPIC_API_KEY = key;
    }
  });
});

describe("the coach's checklists", () => {
  beforeEach(async () => {
    for (const u of [rep, other]) {
      await resetCoachChat(u.id);
      await db.delete(mimirConceptProgress).where(eq(mimirConceptProgress.userId, u.id));
    }
  });

  const say = async (userId: string, reply: string, message = "Here is what I know.") => {
    const result = await sendCoachMessage(userId, { message }, { complete: coach(reply).complete });
    assert.ok(result.ok, JSON.stringify(result));
    return result;
  };

  test("the coach sets out a checklist once and ticks it a point at a time, and the last tick masters the concept", async () => {
    const first = await say(rep.id, "Good start. What does alpha do for the bakery?\n[POINTS: alpha | Alpha comes first | Alpha is a bakery | Alpha saves time]\n[COVERED: alpha 1]");
    assert.deepEqual(first.covered, [{ id: "alpha", points: ["Alpha comes first"], covered: 1, total: 3 }]);
    assert.deepEqual(first.mastered, []);
    assert.deepEqual(first.progress.next?.points, [
      { text: "Alpha comes first", covered: true },
      { text: "Alpha is a bakery", covered: false },
      { text: "Alpha saves time", covered: false },
    ]);

    // The coach knows what it just ticked, so the next turn is not handed the snapshot again.
    const quiet = coach("Right.\n[POINTS: alpha | Something else | And another]\n[COVERED: alpha 2]");
    const second = await sendCoachMessage(rep.id, { message: "It is about a bakery." }, { complete: quiet.complete });
    assert.equal(lastUserContent(quiet.sent[0]!), "It is about a bakery.");
    assert.ok(second.ok);
    // A second checklist does not replace the first: the target never moves, and the next turn shows the coach the one that stands.
    assert.deepEqual(second.covered, [{ id: "alpha", points: ["Alpha is a bakery"], covered: 2, total: 3 }]);
    assert.deepEqual((await getConceptState(rep.id, "alpha")).points?.map((p) => p.text), ["Alpha comes first", "Alpha is a bakery", "Alpha saves time"]);

    // The coach is told which points are still open.
    const c = coach("That's it.\n[COVERED: alpha 3 1]");
    const last = await sendCoachMessage(rep.id, { message: "It saves time." }, { complete: c.complete });
    assert.match(lastUserContent(c.sent[0]!), /1\. \[covered\] Alpha comes first\n {2}2\. \[covered\] Alpha is a bakery\n {2}3\. \[open\] Alpha saves time/);
    assert.ok(last.ok);
    assert.deepEqual(last.covered, [{ id: "alpha", points: ["Alpha saves time"], covered: 3, total: 3 }]);
    assert.deepEqual(last.mastered, ["alpha"]);
    assert.equal(last.progress.next?.id, "beta");
    assert.equal(last.progress.next?.points, null);
    assert.equal((await getConceptState(rep.id, "alpha")).mastered, true);
  });

  test("completing a checklist clears the recommendation, and a recommendation in the same reply does not stand", async () => {
    await say(rep.id, "Watch it.\n[POINTS: gamma | Gamma one | Gamma two]\n[RECOMMEND: gamma]");
    assert.equal((await getConceptState(rep.id, "gamma")).recommended, true);
    const done = await say(rep.id, "Both.\n[COVERED: gamma 1 2]\n[RECOMMEND: gamma]");
    assert.deepEqual([done.mastered, done.recommended], [["gamma"], []]);
    const s = await getConceptState(rep.id, "gamma");
    assert.deepEqual([s.mastered, s.recommended], [true, false]);
  });

  test("a tick before any checklist, or past its end, does nothing", async () => {
    assert.deepEqual((await say(rep.id, "Ok.\n[COVERED: beta 1]")).covered, []);
    assert.equal((await getConceptState(rep.id, "beta")).points, null);
    await say(rep.id, "Ok.\n[POINTS: beta | Beta one | Beta two]");
    assert.deepEqual((await say(rep.id, "Ok.\n[COVERED: beta 5]")).covered, []);
    assert.deepEqual((await say(rep.id, "Again.\n[COVERED: beta 1]\n")).covered.map((c) => c.covered), [1]);
    // A point already ticked is not news.
    assert.deepEqual((await say(rep.id, "Still.\n[COVERED: beta 1]")).covered, []);
  });

  test("each rep's checklist and ticks are their own", async () => {
    await say(rep.id, "Ok.\n[POINTS: beta | Beta one | Beta two]\n[COVERED: beta 1]");
    await say(other.id, "Ok.\n[POINTS: beta | Other one | Other two]");
    assert.deepEqual((await getConceptState(other.id, "beta")).points, [
      { text: "Other one", covered: false },
      { text: "Other two", covered: false },
    ]);
    assert.equal((await getConceptState(rep.id, "beta")).points?.[0]?.covered, true);
  });

  test("a concept's own points are its checklist: the coach cannot replace them, and a tick survives a re-import that keeps the wording", async () => {
    const authored = () =>
      mapFixture({ concepts: mapFixture().concepts.map((c) => (c.id === "alpha" ? { ...c, points: ["Alpha comes first", "Alpha is a bakery"] } : c)) });
    await importMap(admin.id, authored());
    try {
      const view = await getCoachChat(rep.id);
      assert.deepEqual(view.progress.next?.points?.map((p) => p.covered), [false, false]);
      const r = await say(rep.id, "Good.\n[POINTS: alpha | Mine | Yours]\n[COVERED: alpha 2]");
      assert.deepEqual(r.covered, [{ id: "alpha", points: ["Alpha is a bakery"], covered: 1, total: 2 }]);

      const reworded = authored();
      reworded.concepts[0]!.points = ["Alpha comes first", "Alpha bakes bread"];
      await importMap(admin.id, reworded);
      assert.deepEqual((await getCoachChat(rep.id)).progress.next?.points?.map((p) => p.covered), [false, false]);
      await importMap(admin.id, authored());
      assert.deepEqual((await getCoachChat(rep.id)).progress.next?.points?.map((p) => p.covered), [false, true]);
    } finally {
      await importMap(admin.id, mapFixture());
    }
  });

  test("a conversation from before checklists reads as none and is replaced on the next turn, keeping progress", async () => {
    await say(rep.id, "Good.\n[MASTERED: alpha]");
    await db.update(mimirCoachConversations).set({ systemPrompt: "An old coach that only knew [MASTERED: concept-id]." }).where(eq(mimirCoachConversations.userId, rep.id));

    const view = await getCoachChat(rep.id);
    assert.deepEqual([view.conversation, view.needsGreeting, view.progress.mastered], [null, true, 1]);

    const c = coach("Welcome back. Beta next.");
    const greeted = await sendCoachMessage(rep.id, { open: true }, { complete: c.complete });
    assert.ok(greeted.ok);
    assert.match(c.sent[0]!.system, /\[COVERED: concept-id 1 3\]/);
    assert.equal(c.sent[0]!.messages.length, 1);
    assert.equal((await messagesOf(rep.id)).length, 2);
    assert.equal((await getConceptState(rep.id, "alpha")).mastered, true);
  });
});

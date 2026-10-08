/**
 * Mimir against a real database: importing and editing content and the rules
 * on where an item may sit, each person's progress, and coaching
 * conversations — what the coach is sent, what is kept, and what a failed or
 * overlapping send leaves behind. Claude is never called: every send passes
 * its own stand-in for it.
 *
 * Items carry `TEST_PREFIX` in their id, so cleanup finds them.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { mimirConversations, mimirMessages } from "@/db/schema";
import { MIMIR_CONTEXT_LIMIT, getChat, resetChat, sendMessage, type Complete, type CompletionRequest } from "@/lib/mimir/chat";
import { MASTERY_MARKER, kickoffFor } from "@/lib/mimir/coach";
import { createItem, deleteItem, getItem, importItems, listItems, updateItem, type ItemInput } from "@/lib/mimir/items";
import {
  getItemProgress,
  listProgress,
  progressSummary,
  recordVisit,
  resetProgress,
  resumePoint,
  setProfile,
  setReflection,
  tiersFor,
} from "@/lib/mimir/progress";
import { MIMIR_ITEM_LIST, MIMIR_PROGRESS_LIST } from "@/lib/list-specs";
import { PERSONAS } from "../support/access";
import { TEST_PREFIX } from "../support/db";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("mimir");
const P = `${TEST_PREFIX}mimir_`;

let admin: TestUser;
let rep: TestUser;
let other: TestUser;

const input = (fields: Partial<ItemInput> & Pick<ItemInput, "kind" | "title">): ItemInput => ({
  parentId: null,
  position: 0,
  emoji: "",
  color: "",
  summary: "",
  body: "",
  sections: [],
  attrs: {},
  ...fields,
});

const CONTENT: ItemInput[] = [
  input({ id: `${P}sda`, kind: "agent", title: "Software Delivery Agent", summary: "Move changes safely." }),
  input({ id: `${P}cd`, kind: "capability", title: "Continuous Delivery", parentId: `${P}sda`, body: "Verification after deploys.", attrs: { buyer: "VP Eng" } }),
  input({ id: `${P}idp`, kind: "capability", title: "Developer Portal", position: 1 }),
  input({ id: `${P}jenkins`, kind: "competitor", title: "Jenkins", attrs: { cats: ["ci", "cd"], featured: true, strength: "Free" } }),
  input({ id: `${P}gha`, kind: "competitor", title: "GitHub Actions", position: 1, attrs: { cats: ["ci"] } }),
  input({ id: `${P}disc`, kind: "discovery", title: "Deployment pain" }),
  input({ id: `${P}disc_q`, kind: "question", title: "How often do you deploy?", parentId: `${P}disc`, attrs: { why: "Cadence" } }),
  input({ id: `${P}cat`, kind: "category", title: "Foundations" }),
  input({ id: `${P}term`, kind: "term", title: "Canary", parentId: `${P}cat`, summary: "A small first release." }),
];

const FIRST = { q: P, sort: "position" as const, dir: "asc" as const, page: 1 };

/** A stand-in for Claude that records what it was sent and answers with `reply`. */
function coach(reply: string | (() => never), stopReason = "end_turn") {
  const sent: CompletionRequest[] = [];
  const complete: Complete = async (req, stream) => {
    sent.push(structuredClone(req));
    if (typeof reply === "function") reply();
    for (const word of (reply as string).split(/(?<= )/)) stream?.text(word);
    return {
      content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: reply as string }],
      text: reply as string,
      stopReason,
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  };
  return { complete, sent };
}

async function rows(userId: string, itemId: string) {
  const [c] = await db
    .select({ id: mimirConversations.id })
    .from(mimirConversations)
    .where(and(eq(mimirConversations.userId, userId), eq(mimirConversations.itemId, itemId)));
  if (!c) return [];
  return db.select().from(mimirMessages).where(eq(mimirMessages.conversationId, c.id)).orderBy(mimirMessages.seq);
}

before(async () => {
  await scope.setUp();
  admin = await scope.createUser("admin", PERSONAS.trainingAdmin);
  rep = await scope.createUser("rep", PERSONAS.nobody);
  other = await scope.createUser("other", PERSONAS.nobody);
});

after(() => scope.tearDown());

describe("content", () => {
  test("an import makes everything once, and again updates in place", async () => {
    assert.deepEqual(await importItems(admin.id, CONTENT), { ok: true, created: CONTENT.length, updated: 0 });
    const renamed = CONTENT.map((i) => (i.id === `${P}cd` ? { ...i, title: "Continuous Delivery & GitOps" } : i));
    assert.deepEqual(await importItems(admin.id, renamed), { ok: true, created: 0, updated: CONTENT.length });
    assert.equal((await getItem(`${P}cd`))?.item.title, "Continuous Delivery & GitOps");
  });

  test("an import is all or nothing, and names the item it stopped at", async () => {
    const bad = [
      input({ id: `${P}new_one`, kind: "persona", title: "New persona" }),
      input({ id: `${P}orphan`, kind: "question", title: "No group", parentId: `${P}nowhere` }),
    ];
    assert.deepEqual(await importItems(admin.id, bad), { ok: false, error: "bad_parent", index: 1, id: `${P}orphan` });
    assert.equal(await getItem(`${P}new_one`), null);
  });

  test("an import may not change a kind, repeat an id, or nest a question anywhere but a group", async () => {
    const changed = await importItems(admin.id, [input({ id: `${P}gha`, kind: "persona", title: "GitHub Actions" })]);
    assert.equal(changed.ok ? null : changed.error, "kind_fixed");
    const twice = await importItems(admin.id, [input({ id: `${P}x`, kind: "persona", title: "X" }), input({ id: `${P}x`, kind: "persona", title: "X" })]);
    assert.equal(twice.ok ? null : twice.error, "taken");
    const wrong = await importItems(admin.id, [input({ id: `${P}q2`, kind: "question", title: "Q", parentId: `${P}cat` })]);
    assert.equal(wrong.ok ? null : wrong.error, "bad_parent");
  });

  test("a capability sits under an agent or nowhere, and nothing sits under a capability", async () => {
    const underCapability = await createItem(admin.id, input({ id: `${P}deeper`, kind: "capability", title: "Deeper", parentId: `${P}cd` }));
    assert.equal(underCapability.ok ? null : underCapability.error, "bad_parent");
    const underCompetitor = await createItem(admin.id, input({ kind: "capability", title: "Odd", parentId: `${P}jenkins` }));
    assert.equal(underCompetitor.ok ? null : underCompetitor.error, "bad_parent");
    const agentUnderAgent = await createItem(admin.id, input({ kind: "agent", title: "Odd agent", parentId: `${P}sda` }));
    assert.equal(agentUnderAgent.ok ? null : agentUnderAgent.error, "bad_parent");
  });

  test("a new item without an id takes one from its title, numbered past any taken", async () => {
    const a = await createItem(admin.id, input({ kind: "persona", title: `${P}Platform Lead` }));
    const b = await createItem(admin.id, input({ kind: "persona", title: `${P}Platform Lead` }));
    assert.ok(a.ok && b.ok);
    assert.equal(a.id, `${P}platform-lead`);
    assert.equal(b.id, `${P}platform-lead-2`);
    assert.equal((await deleteItem(b.id)).ok, true);
  });

  test("an edit keeps the kind, and an item holding others cannot be removed", async () => {
    const changed = await updateItem(admin.id, `${P}disc`, input({ kind: "persona", title: "Deployment pain" }));
    assert.equal(changed.ok ? null : changed.error, "kind_fixed");
    const kept = await updateItem(admin.id, `${P}disc`, input({ kind: "discovery", title: "Deployment & reliability pain" }));
    assert.ok(kept.ok);
    assert.deepEqual(await deleteItem(`${P}disc`), { ok: false, error: "has_children" });
    assert.deepEqual(await updateItem(admin.id, `${P}nope`, input({ kind: "persona", title: "Nope" })), { ok: false, error: "not_found" });
  });

  test("lists filter by kind, parent, category and top competitors", async () => {
    const titles = async (filter: Parameters<typeof listItems>[1]) => (await listItems({ ...FIRST, q: "" }, filter)).rows.filter((r) => r.id.startsWith(P)).map((r) => r.title);
    assert.deepEqual(await titles({ kind: "competitor", cat: "cd" }), ["Jenkins"]);
    assert.deepEqual(await titles({ kind: "competitor", featured: true }), ["Jenkins"]);
    assert.deepEqual(await titles({ kind: "competitor", cat: "ci" }), ["Jenkins", "GitHub Actions"]);
    assert.deepEqual(await titles({ kind: "capability", parentId: null }), ["Developer Portal"]);
    assert.deepEqual(await titles({ parentId: `${P}sda` }), ["Continuous Delivery & GitOps"]);
    const found = await getItem(`${P}disc`);
    assert.deepEqual(found?.children.map((c) => c.id), [`${P}disc_q`]);
  });

  test("the search matches the summary as well as the title", async () => {
    const page = await listItems({ ...MIMIR_ITEM_LIST, q: "A small first release", page: 1 }, { kind: "term" });
    assert.ok(page.rows.some((r) => r.id === `${P}term`));
  });
});

describe("progress", () => {
  test("opening an item makes it viewed, for that person only", async () => {
    assert.equal(await recordVisit(rep.id, `${P}cd`), true);
    assert.equal(await recordVisit(rep.id, `${P}missing`), false);
    assert.equal((await getItemProgress(rep.id, `${P}cd`)).tier, "viewed");
    assert.equal((await getItemProgress(other.id, `${P}cd`)).tier, "none");
    assert.deepEqual(await tiersFor(rep.id, [`${P}cd`, `${P}jenkins`]), { [`${P}cd`]: "viewed" });
  });

  test("a takeaway is refused until the coach has said the rep is ready", async () => {
    assert.deepEqual(await setReflection(rep.id, `${P}cd`, "Too soon"), { ok: false, error: "not_ready" });
    assert.deepEqual(await setReflection(rep.id, `${P}missing`, "Nothing"), { ok: false, error: "not_found" });
  });
});

describe("coaching", () => {
  test("an agent's coach knows its capabilities", async () => {
    const view = await getChat(rep.id, `${P}sda`);
    assert.ok(!("error" in view));
    assert.equal(view.mode, "agent");
    const { complete, sent } = coach("Good. Now the outcome?");
    assert.ok((await sendMessage(rep.id, `${P}sda`, "It ships changes safely.", { complete })).ok);
    assert.match(sent[0]!.system, /Its capabilities: Continuous Delivery & GitOps/);
    assert.equal(await resetChat(rep.id, `${P}sda`), true);
  });

  test("only the kinds the coach covers have a coach", async () => {
    assert.deepEqual(await getChat(rep.id, `${P}term`), { error: "not_coachable" });
    assert.deepEqual(await getChat(rep.id, `${P}missing`), { error: "not_found" });
    const { complete } = coach("hi");
    assert.deepEqual(await sendMessage(rep.id, `${P}disc`, "hello", { complete }), { ok: false, error: "not_coachable" });
  });

  test("before the first message there is an opener and no conversation", async () => {
    const view = await getChat(rep.id, `${P}cd`);
    assert.ok(!("error" in view));
    assert.equal(view.conversation, null);
    assert.match(view.opener!.text, /Continuous Delivery & GitOps/);
    assert.equal((await rows(rep.id, `${P}cd`)).length, 0);
  });

  test("the first message starts the conversation; the coach is sent the kickoff, the opener and the message", async () => {
    await setProfile(rep.id, { role: "AE", coachStyle: "direct" });
    const { complete, sent } = coach("Good start. What does verification catch?");
    const result = await sendMessage(rep.id, `${P}cd`, "It deploys safely.", { complete });
    assert.ok(result.ok);
    assert.deepEqual(result.messages.map((m) => [m.role, m.text]), [
      ["user", "It deploys safely."],
      ["assistant", "Good start. What does verification catch?"],
    ]);
    assert.equal(result.tier, "practiced");

    const [req] = sent;
    assert.deepEqual(req!.messages.map((m) => m.role), ["user", "assistant", "user"]);
    assert.equal(req!.messages[0]!.content, kickoffFor("Continuous Delivery & GitOps"));
    assert.equal(req!.messages[2]!.content, "It deploys safely.");
    assert.match(req!.system, /Verification after deploys\./);
    assert.match(req!.system, /a capability of the Harness Software Delivery Agent/);
    assert.match(req!.system, /\(AE\)/);
    assert.match(req!.system, /COACHING STYLE: Be concise and direct/);
  });

  test("the coach's turn is kept exactly as returned and sent back unchanged", async () => {
    const { complete, sent } = coach("Next question.");
    assert.ok((await sendMessage(rep.id, `${P}cd`, "It catches bad deploys.", { complete })).ok);
    const turn = sent[0]!.messages[3]!;
    assert.equal(turn.role, "assistant");
    assert.deepEqual(turn.content, [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "Good start. What does verification catch?" },
    ]);
  });

  test("the prompt is fixed when the conversation starts: later edits reach the next one", async () => {
    await updateItem(admin.id, `${P}cd`, { ...CONTENT[1]!, title: "Continuous Delivery & GitOps", body: "Rewritten body." });
    const { complete, sent } = coach("Still on it.");
    assert.ok((await sendMessage(rep.id, `${P}cd`, "More.", { complete })).ok);
    assert.match(sent[0]!.system, /Verification after deploys\./);
    assert.doesNotMatch(sent[0]!.system, /Rewritten body/);
  });

  test("the mastery signal is taken out of the reply and readies the takeaway", async () => {
    const { complete } = coach(`That's it exactly.\n\n${MASTERY_MARKER}`);
    const result = await sendMessage(rep.id, `${P}cd`, "Verification compares metrics to a baseline.", { complete });
    assert.ok(result.ok);
    assert.equal(result.messages[1]!.text, "That's it exactly.");
    assert.equal(result.masteryReady, true);
    assert.equal(result.tier, "practiced");
    assert.deepEqual(await setReflection(rep.id, `${P}cd`, "Deploys that check themselves."), { ok: true, tier: "mastered" });
  });

  test("a failed or declined reply takes the rep's message back out", async () => {
    const before = (await rows(rep.id, `${P}cd`)).length;
    const failed = coach(() => {
      throw new Error("network down");
    });
    assert.deepEqual(await sendMessage(rep.id, `${P}cd`, "Lost?", { complete: failed.complete }), { ok: false, error: "upstream" });
    const declined = coach("", "refusal");
    assert.deepEqual(await sendMessage(rep.id, `${P}cd`, "Declined?", { complete: declined.complete }), { ok: false, error: "refused" });
    assert.equal((await rows(rep.id, `${P}cd`)).length, before);
  });

  test("a second send while the coach is still replying is refused as busy", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Complete = async () => {
      await gate;
      return { content: [{ type: "text", text: "Done." }], text: "Done.", stopReason: "end_turn", usage: {} };
    };
    const first = sendMessage(rep.id, `${P}cd`, "First.", { complete: slow });
    // Let the first save its message before the second arrives.
    for (let i = 0; i < 50 && (await rows(rep.id, `${P}cd`)).at(-1)?.text !== "First."; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(await sendMessage(rep.id, `${P}cd`, "Second.", { complete: coach("x").complete }), { ok: false, error: "busy" });
    release();
    assert.ok((await first).ok);
  });

  test("the page shows every turn but the kickoff, in order", async () => {
    const view = await getChat(rep.id, `${P}cd`);
    assert.ok(!("error" in view) && view.conversation);
    const shown = view.conversation.messages;
    assert.equal(shown[0]!.role, "assistant");
    assert.ok(shown.every((m, i) => i === 0 || m.seq > shown[i - 1]!.seq));
    assert.ok(shown.filter((m) => m.role === "assistant").every((m) => typeof m.html === "string"));
    assert.ok(!shown.some((m) => m.text === kickoffFor("Continuous Delivery & GitOps")));
  });

  test("starting over throws the conversation away and keeps the progress", async () => {
    assert.equal(await resetChat(rep.id, `${P}cd`), true);
    assert.equal(await resetChat(rep.id, `${P}cd`), false);
    assert.equal((await rows(rep.id, `${P}cd`)).length, 0);
    const progress = await getItemProgress(rep.id, `${P}cd`);
    assert.equal(progress.tier, "mastered");
    assert.equal(progress.reflection, "Deploys that check themselves.");
  });
});

describe("long conversations", () => {
  test("the reply streams as it is written, and what streamed is what is saved", async () => {
    const pieces: string[] = [];
    const { complete } = coach("Streamed in three pieces.");
    const result = await sendMessage(rep.id, `${P}jenkins`, "Go.", {
      complete,
      stream: { text: (d) => pieces.push(d), restart: () => pieces.splice(0) },
    });
    assert.ok(result.ok);
    assert.equal(pieces.length, 4);
    assert.equal(pieces.join(""), result.messages[1]!.text);
  });

  test("runs past a hundred turns: every one is sent, and the page shows the latest with the rest a page back", async () => {
    const [c] = await db
      .select({ id: mimirConversations.id })
      .from(mimirConversations)
      .where(and(eq(mimirConversations.userId, rep.id), eq(mimirConversations.itemId, `${P}jenkins`)));
    // Turns 4 to 203, as if sent one by one.
    await db.insert(mimirMessages).values(
      Array.from({ length: 200 }, (_, i) => ({
        conversationId: c!.id,
        seq: 4 + i,
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `turn ${4 + i}`,
        text: `turn ${4 + i}`,
      })),
    );
    const { complete, sent } = coach("Still here.");
    assert.ok((await sendMessage(rep.id, `${P}jenkins`, "Turn 204.", { complete })).ok);
    assert.equal(sent[0]!.messages.length, 205);
    assert.equal(sent[0]!.messages.at(-1)!.content, "Turn 204.");

    const latest = await getChat(rep.id, `${P}jenkins`);
    assert.ok(!("error" in latest) && latest.conversation);
    assert.equal(latest.conversation.messages.length, 100);
    assert.equal(latest.conversation.messages.at(-1)!.text, "Still here.");
    assert.equal(latest.conversation.earlier, true);
    const back = await getChat(rep.id, `${P}jenkins`, latest.conversation.messages[0]!.seq);
    assert.ok(!("error" in back) && back.conversation);
    assert.equal(back.conversation.messages.at(-1)!.seq, latest.conversation.messages[0]!.seq - 1);
  });

  test("the one hard limit is what the model can read", async () => {
    const [c] = await db
      .select({ id: mimirConversations.id })
      .from(mimirConversations)
      .where(and(eq(mimirConversations.userId, rep.id), eq(mimirConversations.itemId, `${P}jenkins`)));
    const [last] = await db
      .select({ seq: mimirMessages.seq })
      .from(mimirMessages)
      .where(eq(mimirMessages.conversationId, c!.id))
      .orderBy(desc(mimirMessages.seq))
      .limit(1);
    await db.update(mimirMessages).set({ usage: { input_tokens: 10, cache_read_input_tokens: MIMIR_CONTEXT_LIMIT, output_tokens: 10 } })
      .where(and(eq(mimirMessages.conversationId, c!.id), eq(mimirMessages.seq, last!.seq)));
    assert.deepEqual(await sendMessage(rep.id, `${P}jenkins`, "One more?", { complete: coach("x").complete }), { ok: false, error: "full" });
    assert.equal(await resetChat(rep.id, `${P}jenkins`), true);
    assert.ok((await sendMessage(rep.id, `${P}jenkins`, "Fresh start.", { complete: coach("Welcome back.").complete })).ok);
  });
});

describe("the progress table", () => {
  test("lists this person's tiers and nobody else's", async () => {
    const mine = await listProgress(rep.id, { ...MIMIR_PROGRESS_LIST, q: "", page: 1 });
    const cd = mine.rows.find((r) => r.id === `${P}cd`);
    assert.equal(cd?.tier, "mastered");
    assert.equal(cd?.reflection, "Deploys that check themselves.");
    assert.ok(!mine.rows.some((r) => r.kind === "term" || r.kind === "question"), "only the kinds progress is kept on");
    const theirs = await listProgress(other.id, { ...MIMIR_PROGRESS_LIST, q: "Continuous Delivery", page: 1 });
    assert.equal(theirs.rows.find((r) => r.id === `${P}cd`)?.tier, "none");
  });

  test("sorts by tier, highest first", async () => {
    const page = await listProgress(rep.id, { q: "", sort: "tier", dir: "desc", page: 1 });
    assert.equal(page.rows[0]!.tier, "mastered");
    assert.equal(page.rows.at(-1)!.tier, "none");
  });

  test("counts tiers for the summary", async () => {
    const summary = await progressSummary(rep.id);
    assert.ok(summary.mastered >= 1 && summary.practiced >= 1 && summary.viewed >= 1);
    assert.ok(summary.total >= summary.viewed);
    assert.equal((await progressSummary(other.id)).viewed, 0);
  });

  test("carries on from the item opened last", async () => {
    await recordVisit(rep.id, `${P}disc`);
    assert.equal((await resumePoint(rep.id))?.id, `${P}disc`);
    assert.equal(await resumePoint(admin.id), null);
  });

  test("a removed item takes everyone's progress and conversations with it", async () => {
    const { complete } = coach("Hello.");
    assert.ok((await sendMessage(other.id, `${P}gha`, "Hi", { complete })).ok);
    assert.deepEqual(await deleteItem(`${P}gha`), { ok: true, title: "GitHub Actions" });
    assert.equal((await rows(other.id, `${P}gha`)).length, 0);
    assert.equal((await getItemProgress(other.id, `${P}gha`)).tier, "none");
  });
});

describe("starting over", () => {
  test("takes this person back to the beginning and leaves everyone else alone", async () => {
    await recordVisit(other.id, `${P}cd`);
    const cleared = await resetProgress(rep.id);
    assert.ok(cleared.items >= 3 && cleared.conversations >= 1);
    assert.equal((await getItemProgress(rep.id, `${P}cd`)).tier, "none");
    assert.equal((await getItemProgress(rep.id, `${P}cd`)).reflection, "");
    assert.equal(await resumePoint(rep.id), null);
    assert.equal((await rows(rep.id, `${P}jenkins`)).length, 0);
    assert.equal((await getItemProgress(other.id, `${P}cd`)).tier, "viewed");
  });
});

/**
 * The map coach's conversation: one per person, carried on with Claude, and
 * the app's side of what the coach decides (a concept mastered, a video
 * recommended).
 *
 * It works the way `lib/mimir/chat.ts` does, and borrows its call to Claude,
 * its replay rules and its limits. A conversation is fixed when it starts (the
 * course is its system prompt) and only ever appended to. What changes is the
 * rep: so the coach is handed a progress snapshot at the start of any turn
 * after their progress has moved, and a *greeting* turn (a hidden "I just
 * opened Mimir") when they open the tab after a while or after finishing a
 * video, so it can say where they are and what comes next.
 *
 * The coach checks each concept point by point against a checklist (the
 * concept's own, or one it sets out with `[POINTS]`), ticks points with
 * `[COVERED]` as the rep says them, and the app masters the concept once the
 * last one is ticked. A conversation started before the coach knew about
 * checklists is replaced, not carried on, the next time the rep writes or
 * opens the tab; their progress stays.
 *
 * A turn is two halves, as there: `beginCoachTurn` saves the rep's message,
 * so a second send while the coach replies is refused as `busy`;
 * `finishCoachTurn` asks Claude, streaming the reply, and saves it, applies
 * the markers it ended with, or takes the rep's message back out if no reply
 * came.
 */

import "server-only";

import { and, asc, count, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { mimirCoachConversations, mimirCoachMessages, users, type MimirMessageRole } from "@/db/schema";
import { renderMarkdown } from "@/lib/markdown";
import { MIMIR_CONTEXT_LIMIT, MIMIR_MODEL, askClaude, coachConfigured, forReplay, tokensOf, type ChatMessage, type Complete, type CompletionRequest, type ReplyStream } from "@/lib/mimir/chat";
import { getProfile } from "@/lib/mimir/progress";
import { getCoachingSettings } from "@/lib/mimir/settings";
import { PAGE_SIZE } from "@/lib/paging";
import { getMap } from "./content";
import {
  OPEN_REQUEST,
  openContent,
  buildCoachSystem,
  knowsChecklists,
  nextConcept,
  progressSnapshot,
  readCoachReply,
  turnContent,
} from "./coach-prompt";
import { coverPoints, getConceptState, listConceptStates, markMastered, markRecommended, setChecklist } from "./progress";
import { countMessage, notePeakMastered } from "./stats";
import { checklistOf, conceptsInOrder, type ConceptPoint, type MapContent } from "./schema";

/** A message left without a reply this long is treated as abandoned (the server stopped mid-call). */
const ABANDONED_MS = 3 * 60_000;
/** Coming back to Mimir after this long earns a fresh greeting even if nothing changed. */
export const GREET_AFTER_MS = 30 * 60_000;

export type CoachError = "not_configured" | "no_map" | "busy" | "full" | "refused" | "upstream";
export const COACH_STATUS_FOR: Record<CoachError, number> = {
  not_configured: 503,
  no_map: 409,
  busy: 409,
  full: 409,
  refused: 422,
  upstream: 502,
};

export type CoachProgress = {
  mastered: number;
  total: number;
  /** `points` is its checklist, ticks and all, or null before there is one. */
  next: { id: string; name: string; hasVideo: boolean; points: ConceptPoint[] | null } | null;
};

export type CoachView = {
  hasMap: boolean;
  configured: boolean;
  conversation: { startedAt: Date; messages: ChatMessage[]; earlier: boolean } | null;
  /** The page should ask the coach to greet them: a new conversation, a long gap, or progress that has moved. */
  needsGreeting: boolean;
  progress: CoachProgress;
};

const EMPTY_PROGRESS: CoachProgress = { mastered: 0, total: 0, next: null };

async function shown(rows: { seq: number; role: MimirMessageRole; text: string; createdAt: Date }[]): Promise<ChatMessage[]> {
  return Promise.all(
    rows.map(async (m) => ({
      seq: m.seq,
      role: m.role,
      text: m.text,
      html: m.role === "assistant" ? (await renderMarkdown(m.text)).html : null,
      at: m.createdAt,
    })),
  );
}

async function standing(userId: string, content: MapContent) {
  const states = await listConceptStates(userId);
  const concepts = conceptsInOrder(content);
  const next = nextConcept(concepts, states);
  const snapshot = progressSnapshot(content, states);
  const progress: CoachProgress = {
    mastered: concepts.filter((c) => states[c.id]?.mastered).length,
    total: concepts.length,
    next: next && { id: next.id, name: next.name, hasVideo: Boolean(next.video), points: checklistOf(next, states[next.id]?.points) },
  };
  return { states, concepts, snapshot, progress };
}

async function conversationOf(userId: string) {
  const [row] = await db.select().from(mimirCoachConversations).where(eq(mimirCoachConversations.userId, userId));
  return row ?? null;
}

/** Their conversation, unless it started before checklists, when it is as good as none: the next turn starts a new one. */
async function currentConversation(userId: string) {
  const row = await conversationOf(userId);
  return row && knowsChecklists(row.systemPrompt) ? row : null;
}

/** This person's conversation as the Chat tab shows it: the latest page of turns, or the page before `before`. */
export async function getCoachChat(userId: string, before?: number): Promise<CoachView> {
  const map = await getMap();
  if (!map) return { hasMap: false, configured: coachConfigured(), conversation: null, needsGreeting: false, progress: EMPTY_PROGRESS };

  const [{ snapshot, progress }, conversation] = await Promise.all([standing(userId, map.content), currentConversation(userId)]);
  const configured = coachConfigured();
  if (!conversation) return { hasMap: true, configured, conversation: null, needsGreeting: configured, progress };

  const rows = await db
    .select({ seq: mimirCoachMessages.seq, role: mimirCoachMessages.role, text: mimirCoachMessages.text, createdAt: mimirCoachMessages.createdAt })
    .from(mimirCoachMessages)
    .where(
      and(
        eq(mimirCoachMessages.userId, userId),
        eq(mimirCoachMessages.shown, true),
        before === undefined ? undefined : lt(mimirCoachMessages.seq, before),
      ),
    )
    .orderBy(desc(mimirCoachMessages.seq))
    .limit(PAGE_SIZE + 1);
  const stale = Date.now() - conversation.updatedAt.getTime() > GREET_AFTER_MS;
  return {
    hasMap: true,
    configured,
    conversation: { startedAt: conversation.startedAt, messages: await shown(rows.slice(0, PAGE_SIZE).reverse()), earlier: rows.length > PAGE_SIZE },
    needsGreeting: configured && before === undefined && (stale || conversation.stateHash !== snapshot.hash),
    progress,
  };
}

/** Starts the conversation if there is none, or if theirs predates checklists. The course is fixed into its system prompt here. */
async function ensureConversation(userId: string, content: MapContent) {
  const existing = await conversationOf(userId);
  if (existing && knowsChecklists(existing.systemPrompt)) return existing;
  if (existing) await resetCoachChat(userId);
  const [[user], profile, settings] = await Promise.all([
    db.select({ name: users.name }).from(users).where(eq(users.id, userId)),
    getProfile(userId),
    getCoachingSettings(),
  ]);
  await db
    .insert(mimirCoachConversations)
    .values({
      userId,
      model: MIMIR_MODEL,
      systemPrompt: buildCoachSystem(content, { name: user?.name ?? null, role: profile.role, coachStyle: profile.coachStyle }, settings),
    })
    .onConflictDoNothing();
  return conversationOf(userId);
}

export type CoachTurn = {
  userId: string;
  systemPrompt: string;
  /** The rep's own words, or null for a greeting, which has none. */
  message: string | null;
  seq: number;
  at: Date;
  conceptIds: string[];
};

export type CoachInput = { message: string } | { open: true };

/**
 * Saves the rep's message (or the hidden "I just opened Mimir" of a
 * greeting), starting the conversation if there is none. Refused while the
 * coach is still replying, and once the conversation is as long as the model
 * can read.
 */
export async function beginCoachTurn(
  userId: string,
  input: CoachInput,
  { needsKey = true }: { needsKey?: boolean } = {},
): Promise<{ ok: true; turn: CoachTurn } | { ok: false; error: CoachError }> {
  const map = await getMap();
  if (!map) return { ok: false, error: "no_map" };
  if (needsKey && !coachConfigured()) return { ok: false, error: "not_configured" };
  const conversation = await ensureConversation(userId, map.content);
  if (!conversation) return { ok: false, error: "upstream" };
  const { snapshot } = await standing(userId, map.content);
  const message = "message" in input ? input.message : null;

  type Claim = { seq: number; at: Date } | { error: "busy" | "full" };
  const claimed = await db.transaction(async (tx): Promise<Claim> => {
    await tx.select({ id: mimirCoachConversations.userId }).from(mimirCoachConversations).where(eq(mimirCoachConversations.userId, userId)).for("update");
    let [last] = await tx
      .select({ seq: mimirCoachMessages.seq, role: mimirCoachMessages.role, createdAt: mimirCoachMessages.createdAt })
      .from(mimirCoachMessages)
      .where(eq(mimirCoachMessages.userId, userId))
      .orderBy(desc(mimirCoachMessages.seq))
      .limit(1);
    if (last?.role === "user") {
      if (Date.now() - last.createdAt.getTime() < ABANDONED_MS) return { error: "busy" };
      await tx.delete(mimirCoachMessages).where(and(eq(mimirCoachMessages.userId, userId), eq(mimirCoachMessages.seq, last.seq)));
      [last] = await tx
        .select({ seq: mimirCoachMessages.seq, role: mimirCoachMessages.role, createdAt: mimirCoachMessages.createdAt })
        .from(mimirCoachMessages)
        .where(eq(mimirCoachMessages.userId, userId))
        .orderBy(desc(mimirCoachMessages.seq))
        .limit(1);
    }
    const [lastReply] = await tx
      .select({ usage: mimirCoachMessages.usage })
      .from(mimirCoachMessages)
      .where(and(eq(mimirCoachMessages.userId, userId), eq(mimirCoachMessages.role, "assistant")))
      .orderBy(desc(mimirCoachMessages.seq))
      .limit(1);
    if (tokensOf(lastReply?.usage ?? null) >= MIMIR_CONTEXT_LIMIT) return { error: "full" };

    const seq = (last?.seq ?? -1) + 1;
    // The snapshot goes first whenever progress has moved since the coach last saw it, and always when greeting.
    const fresh = message === null || conversation.stateHash !== snapshot.hash;
    let sent = message;
    if (message === null) {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(mimirCoachMessages)
        .where(and(eq(mimirCoachMessages.userId, userId), eq(mimirCoachMessages.role, "user"), eq(mimirCoachMessages.shown, false)));
      sent = openContent(n ?? 0);
    }
    const content = turnContent(sent ?? OPEN_REQUEST, fresh ? snapshot : null);
    const [row] = await tx
      .insert(mimirCoachMessages)
      .values({ userId, seq, role: "user", shown: message !== null, content, text: message ?? OPEN_REQUEST })
      .returning({ createdAt: mimirCoachMessages.createdAt });
    await tx.update(mimirCoachConversations).set({ stateHash: snapshot.hash, updatedAt: new Date() }).where(eq(mimirCoachConversations.userId, userId));
    return { seq, at: row!.createdAt };
  });
  if ("error" in claimed) return { ok: false, error: claimed.error };
  if (message !== null) await countMessage(userId);
  return {
    ok: true,
    turn: { userId, systemPrompt: conversation.systemPrompt, message, ...claimed, conceptIds: conceptsInOrder(map.content).map((c) => c.id) },
  };
}

/** Every stored turn, in order, a page at a time, as the API is sent them. */
async function historyOf(userId: string): Promise<CompletionRequest["messages"]> {
  const all: CompletionRequest["messages"] = [];
  let after = -1;
  for (;;) {
    const page = await db
      .select({ seq: mimirCoachMessages.seq, role: mimirCoachMessages.role, content: mimirCoachMessages.content })
      .from(mimirCoachMessages)
      .where(and(eq(mimirCoachMessages.userId, userId), gt(mimirCoachMessages.seq, after)))
      .orderBy(asc(mimirCoachMessages.seq))
      .limit(PAGE_SIZE);
    for (const m of page) all.push({ role: m.role, content: m.role === "assistant" ? forReplay(m.content) : m.content });
    if (page.length < PAGE_SIZE) return all;
    after = page.at(-1)!.seq;
  }
}

/** Points a reply ticked on one concept, by their words, and where that leaves its checklist. */
export type CoveredPoints = { id: string; points: string[]; covered: number; total: number };

export type CoachSendResult =
  | { ok: true; messages: ChatMessage[]; progress: CoachProgress; mastered: string[]; recommended: string[]; covered: CoveredPoints[] }
  | { ok: false; error: CoachError };

/**
 * Asks the coach to answer a saved turn and saves the reply, streaming it to
 * `stream` as it arrives, then does what the reply's markers ask. `complete`
 * is the call to Claude; the database suite passes its own.
 */
export async function finishCoachTurn(
  turn: CoachTurn,
  { complete = askClaude, stream }: { complete?: Complete; stream?: ReplyStream } = {},
): Promise<CoachSendResult> {
  const takeBack = () => db.delete(mimirCoachMessages).where(and(eq(mimirCoachMessages.userId, turn.userId), eq(mimirCoachMessages.seq, turn.seq)));

  let completion;
  try {
    completion = await complete({ system: turn.systemPrompt, messages: await historyOf(turn.userId) }, stream);
  } catch (err) {
    console.error("mimir: the map coach's reply failed", err);
    await takeBack();
    return { ok: false, error: "upstream" };
  }
  if (completion.stopReason === "refusal") {
    await takeBack();
    return { ok: false, error: "refused" };
  }
  const reply = readCoachReply(completion.text, new Set(turn.conceptIds));
  if (!reply.text) {
    await takeBack();
    return { ok: false, error: "upstream" };
  }

  const [saved] = await db
    .insert(mimirCoachMessages)
    .values({ userId: turn.userId, seq: turn.seq + 1, role: "assistant", content: completion.content, text: reply.text, usage: completion.usage })
    .returning({ createdAt: mimirCoachMessages.createdAt });
  // A checklist first, so a reply that sets one and ticks it at once does both; then the ticks, which master a concept once complete.
  const map = await getMap();
  const conceptOf = (id: string) => (map ? conceptsInOrder(map.content).find((c) => c.id === id) : undefined);
  // Whether the checklists now stand as the coach believes; when not, it is shown them as they are next turn.
  let asItThinks = true;
  for (const { id, points } of reply.checklists) {
    const concept = conceptOf(id);
    if (!concept || (await setChecklist(turn.userId, concept, points))) continue;
    const kept = checklistOf(concept, (await getConceptState(turn.userId, id)).points);
    if (kept?.map((p) => p.text).join("\n") !== points.join("\n")) asItThinks = false;
  }
  const mastered = [...reply.mastered];
  const covered: CoveredPoints[] = [];
  for (const { id, points } of reply.covered) {
    const concept = conceptOf(id);
    const done = concept ? await coverPoints(turn.userId, concept, points) : null;
    if (!done || points.some((n) => n > done.checklist.length)) asItThinks = false;
    if (!done) continue;
    if (done.ticked.length) covered.push({ id, points: done.ticked, covered: done.checklist.filter((p) => p.covered).length, total: done.checklist.length });
    if (done.complete && !mastered.includes(id)) mastered.push(id);
  }
  for (const id of mastered) await markMastered(turn.userId, id);
  const recommended = reply.recommended.filter((id) => !mastered.includes(id));
  for (const id of recommended) await markRecommended(turn.userId, id);

  // The coach knows what it just did: the next turn need not be told, and opening the tab is not a change.
  // Unless the app did not do it as asked: then the next turn, or opening the tab, shows it how things stand.
  const now = map ? await standing(turn.userId, map.content) : null;
  if (now) await notePeakMastered(turn.userId, now.progress.mastered);
  await db
    .update(mimirCoachConversations)
    .set({ updatedAt: new Date(), ...(now && asItThinks ? { stateHash: now.snapshot.hash } : {}) })
    .where(eq(mimirCoachConversations.userId, turn.userId));

  const rows = [
    ...(turn.message === null ? [] : [{ seq: turn.seq, role: "user" as const, text: turn.message, createdAt: turn.at }]),
    { seq: turn.seq + 1, role: "assistant" as const, text: reply.text, createdAt: saved!.createdAt },
  ];
  return { ok: true, messages: await shown(rows), progress: now?.progress ?? EMPTY_PROGRESS, mastered, recommended, covered };
}

/** Both halves at once. */
export async function sendCoachMessage(
  userId: string,
  input: CoachInput,
  options: { complete?: Complete; stream?: ReplyStream } = {},
): Promise<CoachSendResult> {
  const begun = await beginCoachTurn(userId, input, { needsKey: !options.complete });
  if (!begun.ok) return begun;
  return finishCoachTurn(begun.turn, options);
}

/** Throws the conversation away so the next one starts afresh, under the course as it is now. Their progress stays. */
export async function resetCoachChat(userId: string): Promise<boolean> {
  const deleted = await db.delete(mimirCoachConversations).where(eq(mimirCoachConversations.userId, userId)).returning({ id: mimirCoachConversations.userId });
  return deleted.length > 0;
}

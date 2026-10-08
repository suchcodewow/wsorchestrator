/**
 * Coaching conversations: one per person per item, carried on with Claude.
 *
 * A conversation is fixed when it starts — its system prompt, an unshown
 * kickoff from the rep and the coach's opener — and only ever appended to
 * after. The API is sent the stored turns exactly as they were sent and
 * returned, thinking blocks and all: a reply is only valid against the prompt
 * and history it was written under, which is also what keeps the prompt cache
 * warm.
 *
 * A turn has two halves. `beginTurn` saves the rep's message, so a second send
 * while the coach is replying finds the last turn is the rep's and is refused
 * as `busy`; `finishTurn` asks Claude, streaming the reply as it comes, and
 * saves it, or takes the rep's message back out if no reply came. A message
 * left without a reply for a few minutes (the server stopped mid-call) is
 * treated as abandoned and replaced. No transaction is held across the call.
 *
 * There is no cap on how long a conversation runs. The one hard limit is how
 * much the model can read: once the last turn came within reach of Claude
 * Sonnet 5.5's context window, the conversation is `full` and the rep starts
 * a new one.
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  MIMIR_MESSAGE_MAX,
  mimirConversations,
  mimirMessages,
  mimirProgress,
  users,
  type MimirMessageRole,
} from "@/db/schema";
import { renderMarkdown } from "@/lib/markdown";
import { buildSystemPrompt, kickoffFor, openerFor, readReply, type CoachItem, type RepContext } from "@/lib/mimir/coach";
import { getItem } from "@/lib/mimir/items";
import { coachModeOf, type CoachMode, type Tier } from "@/lib/mimir/kinds";
import { getCoachingSettings } from "@/lib/mimir/settings";
import { getItemProgress, getProfile, practicedCapabilities, type ItemProgress } from "@/lib/mimir/progress";
import { PAGE_SIZE } from "@/lib/paging";

/** Fast and inexpensive, with thinking kept short: coaching is conversation, not a long agentic task. */
export const MIMIR_MODEL = "claude-sonnet-5-5";
const EFFORT = "low";
/**
 * Answers when Claude Sonnet 5.5 itself can't be reached or is overloaded,
 * after the SDK's own retries: smaller and quicker, on capacity of its own. A
 * request Claude declines is a different case, which the API reroutes itself
 * (`fallbacks: "default"`).
 */
export const MIMIR_FALLBACK_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 16_000;
const ABANDONED_MS = 3 * 60_000;
/** Claude Sonnet 5.5 reads 1M tokens; a conversation whose last turn came this close cannot take another. */
export const MIMIR_CONTEXT_LIMIT = 950_000;

/** Whether the server has a Claude key. Without one the library works and the coach does not. */
export function coachConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type ChatMessage = {
  seq: number;
  role: MimirMessageRole;
  text: string;
  /** The coach's turns rendered from Markdown; null for the rep's, which are plain text. */
  html: string | null;
  at: Date;
};

export type ChatView = {
  mode: CoachMode;
  /** The latest page of turns, or the page asked for; `earlier` says whether older ones come before them. */
  conversation: { id: string; startedAt: Date; messages: ChatMessage[]; earlier: boolean } | null;
  /** What the coach will open with, while there is no conversation yet. */
  opener: { text: string; html: string } | null;
  progress: ItemProgress;
  configured: boolean;
};

export type ChatError = "not_found" | "not_coachable" | "not_configured" | "busy" | "full" | "refused" | "upstream";

export const CHAT_STATUS_FOR: Record<ChatError, number> = {
  not_found: 404,
  not_coachable: 409,
  not_configured: 503,
  busy: 409,
  full: 409,
  refused: 422,
  upstream: 502,
};

export const messageSchema = z.object({ message: z.string().trim().min(1).max(MIMIR_MESSAGE_MAX) });

/** What a completion needs, and what comes back: the stored turns in, the reply's content out. */
export type CompletionRequest = { system: string; messages: { role: MimirMessageRole; content: unknown }[] };
export type Completion = {
  /** The response's content blocks, exactly as returned, to be sent back next turn. */
  content: unknown[];
  text: string;
  stopReason: string | null;
  usage: Record<string, unknown>;
};
/** Where a streamed reply goes as it arrives. `restart` throws away what came so far: the answer is starting again. */
export type ReplyStream = { text(delta: string): void; restart(): void };
export type Complete = (req: CompletionRequest, stream?: ReplyStream) => Promise<Completion>;

let client: Anthropic | null = null;

/**
 * The reply's text. After a mid-reply fallback the new model carries on from
 * where the declined one stopped, so the text either side of a `fallback`
 * block is one passage, not two.
 */
function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  let text = "";
  let joined = false;
  for (const block of content) {
    if (block.type === "fallback") joined = true;
    if (block.type !== "text") continue;
    text += text && !joined ? `\n\n${block.text}` : block.text;
    joined = false;
  }
  return text;
}

async function streamed(
  params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
  stream: ReplyStream | undefined,
): Promise<Completion> {
  const s = client!.beta.messages.stream(params);
  if (stream) s.on("text", (delta) => stream.text(delta));
  const message = await s.finalMessage();
  return {
    content: message.content,
    text: textOf(message.content),
    stopReason: message.stop_reason,
    usage: { ...message.usage, model: message.model },
  };
}

/** Claude could not answer at all, as opposed to answering with an error about the request. */
function unavailable(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.RateLimitError) return true;
  return err instanceof Anthropic.APIError && (err.status ?? 0) >= 500;
}

/**
 * One coach turn from Claude, streamed. A request Claude declines is rerouted
 * by the API to Anthropic's chosen fallback model; if Claude Sonnet 5.5 can't
 * be reached at all, the turn is answered by the fallback model instead.
 */
export const askClaude: Complete = async ({ system, messages }, stream) => {
  client ??= new Anthropic();
  const history = messages as Anthropic.Beta.BetaMessageParam[];
  try {
    return await streamed(
      {
        model: MIMIR_MODEL,
        max_tokens: MAX_TOKENS,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: EFFORT },
        // Caches the whole conversation so far; each turn reads the last one's.
        cache_control: { type: "ephemeral" },
        system,
        messages: history,
      },
      stream,
    );
  } catch (err) {
    if (!unavailable(err)) throw err;
    console.warn(`mimir: ${MIMIR_MODEL} unavailable, answering on ${MIMIR_FALLBACK_MODEL}`, err);
    stream?.restart();
    return streamed(
      { model: MIMIR_FALLBACK_MODEL, max_tokens: MAX_TOKENS, cache_control: { type: "ephemeral" }, system, messages: history },
      stream,
    );
  }
};

/**
 * A stored coach turn as it is sent back. After a mid-reply fallback the
 * blocks the declined model wrote before the last `fallback` block, other than
 * its text, are left out, as the API asks.
 */
export function forReplay(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const blocks = content as { type?: string }[];
  const boundary = blocks.map((b) => b.type).lastIndexOf("fallback");
  if (boundary < 0) return content;
  return blocks.filter((b, i) => i >= boundary || !["thinking", "redacted_thinking", "tool_use"].includes(b.type ?? ""));
}

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

async function repContext(userId: string): Promise<RepContext> {
  const [[user], profile, capabilities] = await Promise.all([
    db.select({ name: users.name }).from(users).where(eq(users.id, userId)),
    getProfile(userId),
    practicedCapabilities(userId),
  ]);
  return { name: user?.name ?? null, role: profile.role, coachStyle: profile.coachStyle, capabilities };
}

/** An item as the coach reads it: a capability with the agent it belongs to, an agent with its capabilities. */
function coachItem(found: NonNullable<Awaited<ReturnType<typeof getItem>>>): CoachItem {
  const { item, parent, children } = found;
  return {
    ...item,
    agent: item.kind === "capability" && parent?.kind === "agent" ? parent.title : null,
    capabilities: item.kind === "agent" ? children.filter((c) => c.kind === "capability").map((c) => c.title) : [],
  };
}

async function conversationOf(userId: string, itemId: string) {
  const [row] = await db
    .select()
    .from(mimirConversations)
    .where(and(eq(mimirConversations.userId, userId), eq(mimirConversations.itemId, itemId)));
  return row ?? null;
}

/**
 * This person's conversation about an item, as the page shows it — the
 * latest page of turns, or the page before `before` — or the opener, before
 * there is a conversation.
 */
export async function getChat(
  userId: string,
  itemId: string,
  before?: number,
): Promise<ChatView | { error: "not_found" | "not_coachable" }> {
  const found = await getItem(itemId);
  if (!found) return { error: "not_found" };
  const mode = coachModeOf(found.item.kind);
  if (!mode) return { error: "not_coachable" };

  const [conversation, progress] = await Promise.all([conversationOf(userId, itemId), getItemProgress(userId, itemId)]);
  if (!conversation) {
    const text = openerFor(mode, coachItem(found), await repContext(userId));
    return {
      mode,
      conversation: null,
      opener: { text, html: (await renderMarkdown(text)).html },
      progress,
      configured: coachConfigured(),
    };
  }

  const rows = await db
    .select({ seq: mimirMessages.seq, role: mimirMessages.role, text: mimirMessages.text, createdAt: mimirMessages.createdAt })
    .from(mimirMessages)
    .where(
      and(
        eq(mimirMessages.conversationId, conversation.id),
        eq(mimirMessages.shown, true),
        before === undefined ? undefined : lt(mimirMessages.seq, before),
      ),
    )
    .orderBy(desc(mimirMessages.seq))
    .limit(PAGE_SIZE + 1);
  return {
    mode: conversation.mode as CoachMode,
    conversation: {
      id: conversation.id,
      startedAt: conversation.startedAt,
      messages: await shown(rows.slice(0, PAGE_SIZE).reverse()),
      earlier: rows.length > PAGE_SIZE,
    },
    opener: null,
    progress,
    configured: coachConfigured(),
  };
}

/** Starts the conversation if there is none: the prompt is fixed here, with the kickoff and the opener. */
async function ensureConversation(userId: string, itemId: string, mode: CoachMode) {
  const existing = await conversationOf(userId, itemId);
  if (existing) return existing;

  const [found, rep, settings] = await Promise.all([getItem(itemId), repContext(userId), getCoachingSettings()]);
  if (!found) return null;
  const item = coachItem(found);
  const opener = openerFor(mode, item, rep);
  const kickoff = kickoffFor(found.item.title);

  await db.transaction(async (tx) => {
    const [made] = await tx
      .insert(mimirConversations)
      .values({
        userId,
        itemId,
        mode,
        model: MIMIR_MODEL,
        systemPrompt: buildSystemPrompt(mode, item, rep, settings),
      })
      .onConflictDoNothing()
      .returning({ id: mimirConversations.id });
    // Someone else's request made it first: theirs stands.
    if (!made) return;
    await tx.insert(mimirMessages).values([
      { conversationId: made.id, seq: 0, role: "user", shown: false, content: kickoff, text: kickoff },
      { conversationId: made.id, seq: 1, role: "assistant", shown: true, content: opener, text: opener },
    ]);
  });
  return conversationOf(userId, itemId);
}

export type SendResult =
  | { ok: true; messages: ChatMessage[]; masteryReady: boolean; tier: Tier }
  | { ok: false; error: ChatError };

/** A rep's message, saved and waiting for the coach's reply. */
export type Turn = {
  userId: string;
  itemId: string;
  conversationId: string;
  systemPrompt: string;
  message: string;
  seq: number;
  at: Date;
};

/** The tokens a coach turn's request and reply came to, from its stored usage. */
function tokensOf(usage: Record<string, unknown> | null): number {
  if (!usage) return 0;
  const n = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
  return n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens") + n("output_tokens");
}

/**
 * Saves the rep's message, starting the conversation if there is none.
 * Refused while the coach is still replying, and once the conversation is as
 * long as the model can read.
 */
export async function beginTurn(
  userId: string,
  itemId: string,
  message: string,
  { needsKey = true }: { needsKey?: boolean } = {},
): Promise<{ ok: true; turn: Turn } | { ok: false; error: ChatError }> {
  const found = await getItem(itemId);
  if (!found) return { ok: false, error: "not_found" };
  const mode = coachModeOf(found.item.kind);
  if (!mode) return { ok: false, error: "not_coachable" };
  if (needsKey && !coachConfigured()) return { ok: false, error: "not_configured" };

  const conversation = await ensureConversation(userId, itemId, mode);
  if (!conversation) return { ok: false, error: "not_found" };

  type Claim = { seq: number; at: Date } | { error: "not_found" | "busy" | "full" };
  const claimed = await db.transaction(async (tx): Promise<Claim> => {
    await tx.select({ id: mimirConversations.id }).from(mimirConversations).where(eq(mimirConversations.id, conversation.id)).for("update");
    let [last] = await tx
      .select({ seq: mimirMessages.seq, role: mimirMessages.role, createdAt: mimirMessages.createdAt })
      .from(mimirMessages)
      .where(eq(mimirMessages.conversationId, conversation.id))
      .orderBy(desc(mimirMessages.seq))
      .limit(1);
    if (!last) return { error: "not_found" as const };
    if (last.role === "user" && last.seq > 0) {
      if (Date.now() - last.createdAt.getTime() < ABANDONED_MS) return { error: "busy" as const };
      await tx
        .delete(mimirMessages)
        .where(and(eq(mimirMessages.conversationId, conversation.id), eq(mimirMessages.seq, last.seq)));
      last = { ...last, seq: last.seq - 1 };
    }
    const [lastReply] = await tx
      .select({ usage: mimirMessages.usage })
      .from(mimirMessages)
      .where(and(eq(mimirMessages.conversationId, conversation.id), eq(mimirMessages.role, "assistant")))
      .orderBy(desc(mimirMessages.seq))
      .limit(1);
    if (tokensOf(lastReply?.usage ?? null) >= MIMIR_CONTEXT_LIMIT) return { error: "full" as const };

    const seq = last.seq + 1;
    const [row] = await tx
      .insert(mimirMessages)
      .values({ conversationId: conversation.id, seq, role: "user", content: message, text: message })
      .returning({ createdAt: mimirMessages.createdAt });
    const now = new Date();
    await tx
      .insert(mimirProgress)
      .values({ userId, itemId, firstVisitAt: now, lastVisitAt: now, practicedAt: now })
      .onConflictDoUpdate({
        target: [mimirProgress.userId, mimirProgress.itemId],
        set: { lastVisitAt: now, practicedAt: sql`coalesce(${mimirProgress.practicedAt}, ${now})` },
      });
    return { seq, at: row!.createdAt };
  });
  if ("error" in claimed) return { ok: false, error: claimed.error };
  return {
    ok: true,
    turn: { userId, itemId, conversationId: conversation.id, systemPrompt: conversation.systemPrompt, message, ...claimed },
  };
}

/** Every stored turn of a conversation, in order, a page at a time, as the API is sent them. */
async function historyOf(conversationId: string): Promise<CompletionRequest["messages"]> {
  const all: CompletionRequest["messages"] = [];
  let after = -1;
  for (;;) {
    const page = await db
      .select({ seq: mimirMessages.seq, role: mimirMessages.role, content: mimirMessages.content })
      .from(mimirMessages)
      .where(and(eq(mimirMessages.conversationId, conversationId), gt(mimirMessages.seq, after)))
      .orderBy(asc(mimirMessages.seq))
      .limit(PAGE_SIZE);
    for (const m of page) all.push({ role: m.role, content: m.role === "assistant" ? forReplay(m.content) : m.content });
    if (page.length < PAGE_SIZE) return all;
    after = page.at(-1)!.seq;
  }
}

/**
 * Asks the coach to answer a saved turn and saves the reply, streaming it to
 * `stream` as it arrives. `complete` is the call to Claude; the database suite
 * passes its own.
 */
export async function finishTurn(
  turn: Turn,
  { complete = askClaude, stream }: { complete?: Complete; stream?: ReplyStream } = {},
): Promise<SendResult> {
  const takeBack = () =>
    db
      .delete(mimirMessages)
      .where(and(eq(mimirMessages.conversationId, turn.conversationId), eq(mimirMessages.seq, turn.seq)));

  let completion: Completion;
  try {
    completion = await complete({ system: turn.systemPrompt, messages: await historyOf(turn.conversationId) }, stream);
  } catch (err) {
    console.error("mimir: the coach's reply failed", err);
    await takeBack();
    return { ok: false, error: "upstream" };
  }
  if (completion.stopReason === "refusal") {
    await takeBack();
    return { ok: false, error: "refused" };
  }
  const reply = readReply(completion.text);
  if (!reply.text) {
    await takeBack();
    return { ok: false, error: "upstream" };
  }

  const now = new Date();
  const [saved] = await db
    .insert(mimirMessages)
    .values({
      conversationId: turn.conversationId,
      seq: turn.seq + 1,
      role: "assistant",
      content: completion.content,
      text: reply.text,
      usage: completion.usage,
    })
    .returning({ createdAt: mimirMessages.createdAt });
  await db.update(mimirConversations).set({ updatedAt: now }).where(eq(mimirConversations.id, turn.conversationId));
  if (reply.mastery) {
    await db
      .update(mimirProgress)
      .set({ masteryReadyAt: sql`coalesce(${mimirProgress.masteryReadyAt}, ${now})` })
      .where(and(eq(mimirProgress.userId, turn.userId), eq(mimirProgress.itemId, turn.itemId)));
  }

  const progress = await getItemProgress(turn.userId, turn.itemId);
  return {
    ok: true,
    messages: await shown([
      { seq: turn.seq, role: "user", text: turn.message, createdAt: turn.at },
      { seq: turn.seq + 1, role: "assistant", text: reply.text, createdAt: saved!.createdAt },
    ]),
    masteryReady: progress.masteryReady,
    tier: progress.tier,
  };
}

/** Both halves at once: the rep's message, and the coach's reply to it. */
export async function sendMessage(
  userId: string,
  itemId: string,
  message: string,
  options: { complete?: Complete; stream?: ReplyStream } = {},
): Promise<SendResult> {
  const begun = await beginTurn(userId, itemId, message, { needsKey: !options.complete });
  if (!begun.ok) return begun;
  return finishTurn(begun.turn, options);
}

/**
 * Throws away this person's conversation about an item so the next message
 * starts afresh, under the item and settings as they are now. Their progress,
 * mastery and takeaway stay.
 */
export async function resetChat(userId: string, itemId: string): Promise<boolean> {
  const deleted = await db
    .delete(mimirConversations)
    .where(and(eq(mimirConversations.userId, userId), eq(mimirConversations.itemId, itemId)))
    .returning({ id: mimirConversations.id });
  return deleted.length > 0;
}

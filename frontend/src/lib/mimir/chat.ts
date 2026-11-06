/**
 * Coach Canary's call to Claude, shared by the map coach in
 * `lib/mimir/map/coach.ts`: the model and its fallback, streaming a reply,
 * the rules for sending a stored turn back, and the one hard limit on a
 * conversation, which is how much the model can read.
 *
 * The API is sent the stored turns exactly as they were sent and returned,
 * thinking blocks and all: a reply is only valid against the prompt and
 * history it was written under, which is also what keeps the prompt cache
 * warm.
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { MimirMessageRole } from "@/db/schema";

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

/** The tokens a coach turn's request and reply came to, from its stored usage. */
export function tokensOf(usage: Record<string, unknown> | null): number {
  if (!usage) return 0;
  const n = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
  return n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens") + n("output_tokens");
}

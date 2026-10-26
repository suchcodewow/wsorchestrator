/**
 * The loop that lets Claude work through a job with the studio's tools. A
 * manual loop rather than the SDK's tool runner, so each tool can refuse an
 * input it was handed, and `finish` can refuse to end the job until the work
 * it stands for has been done.
 *
 * The conversation is append-only: earlier turns are never trimmed or
 * rewritten, so Claude's thinking on them stays valid on later requests.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { anthropicKey } from "./secrets.js";

export const MODEL = "claude-opus-5-5";

/** What a tool hands back: text, with pictures where Claude needs to look at something. */
export type ToolOutput = string | (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[];

export type Tool<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  schema: S;
  /** The schema as JSON Schema, for the API; `schema` is what each input is checked against. */
  inputSchema: Anthropic.Tool.InputSchema;
  run(input: z.infer<S>): Promise<ToolOutput>;
};

/** A tool's failure that Claude should see and can act on, as opposed to one that ends the job. */
export class ToolError extends Error {}

/** A tool calling this ends the loop; its input is the job's answer. */
export class Done<T> {
  constructor(readonly value: T) {}
}

export const image = (jpeg: Buffer): Anthropic.ImageBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
});

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: anthropicKey(), maxRetries: 4, timeout: 20 * 60 * 1000 }));

export type AgentRun<T> = {
  system: string;
  tools: Tool[];
  /** The opening user turn. */
  prompt: Anthropic.MessageParam["content"];
  /** The tool whose successful call ends the run. It may throw a `ToolError` to refuse. */
  finish: Omit<Tool, "run"> & { run(input: any): Promise<T> };
  maxTurns: number;
  /** When to stop, as a `Date.now()` value. */
  deadline: number;
  onTurn?: (turn: number, toolNames: string[]) => Promise<void>;
};

/**
 * Runs Claude until it calls `finish` and `finish` accepts. Throws when it
 * stops without doing so, runs out of turns or time, or the API refuses.
 */
export async function runAgent<T>(run: AgentRun<T>): Promise<T> {
  const tools: Anthropic.Tool[] = [...run.tools, run.finish].map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
    eager_input_streaming: true,
  }));
  const byName = new Map(run.tools.map((t) => [t.name, t]));
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: run.prompt }];
  let nudged = false;

  for (let turn = 1; turn <= run.maxTurns; turn++) {
    if (Date.now() > run.deadline) throw new Error(`Ran out of time after ${turn - 1} turns without finishing.`);
    const response = await anthropic()
      .messages.stream({
        model: MODEL,
        max_tokens: 64_000,
        system: run.system,
        tools,
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        cache_control: { type: "ephemeral" },
      })
      .finalMessage();
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") throw new Error("Claude declined to carry on with the job.");
    if (response.stop_reason === "max_tokens") throw new Error("A reply ran past the output limit.");
    if (response.stop_reason === "model_context_window_exceeded") throw new Error("The job's conversation outgrew Claude's context window.");
    if (response.stop_reason === "pause_turn") continue;

    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    await run.onTurn?.(turn, calls.map((c) => c.name));
    if (calls.length === 0) {
      // It stopped talking without finishing. Once, say so; twice, give up.
      if (nudged) throw new Error("Claude stopped without finishing the job.");
      nudged = true;
      messages.push({ role: "user", content: `The job is not done until you call \`${run.finish.name}\`. Carry on.` });
      continue;
    }
    nudged = false;

    const results: Anthropic.ToolResultBlockParam[] = [];
    let done: Done<T> | null = null;
    for (const call of calls) {
      const result = (content: ToolOutput, isError = false): Anthropic.ToolResultBlockParam => ({
        type: "tool_result",
        tool_use_id: call.id,
        content,
        ...(isError ? { is_error: true } : {}),
      });
      if (call.name === run.finish.name) {
        const parsed = run.finish.schema.safeParse(call.input);
        if (!parsed.success) {
          results.push(result(`INVALID_JSON: the input did not match the tool's schema: ${parsed.error.message.slice(0, 1500)}`, true));
          continue;
        }
        try {
          done = new Done(await run.finish.run(parsed.data));
          results.push(result("Accepted."));
        } catch (err) {
          if (!(err instanceof ToolError)) throw err;
          results.push(result(err.message, true));
        }
        continue;
      }
      const tool = byName.get(call.name);
      if (!tool) {
        results.push(result(`There is no tool called ${call.name}.`, true));
        continue;
      }
      // Streamed input can arrive cut short; check it against the schema before acting on it.
      const parsed = tool.schema.safeParse(call.input);
      if (!parsed.success) {
        results.push(result(`INVALID_JSON: the input did not match the tool's schema: ${parsed.error.message.slice(0, 1500)}`, true));
        continue;
      }
      try {
        results.push(result(await tool.run(parsed.data)));
      } catch (err) {
        if (!(err instanceof ToolError)) throw err;
        results.push(result(err.message, true));
      }
    }
    if (done) return done.value;
    messages.push({ role: "user", content: results });
  }
  throw new Error(`Stopped after ${run.maxTurns} turns without finishing.`);
}

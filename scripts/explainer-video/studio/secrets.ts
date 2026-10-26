/**
 * The two keys the studio spends: Anthropic's for Claude, ElevenLabs' for the
 * narration. On Cloud Run each is a secret in the environment; on a
 * developer's machine they come from `frontend/.env`, read here and kept in
 * memory. Neither is ever logged, written to a file or put on a command line;
 * the ElevenLabs token reaches the engine's scripts only through their
 * environment.
 */

import { readFileSync } from "node:fs";
import { ENV_FILE } from "../lib/config.js";

function fromEnvFile(name: string): string | undefined {
  try {
    const m = readFileSync(ENV_FILE, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
    return m?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

function secret(name: string): string {
  const value = process.env[name] || fromEnvFile(name);
  if (!value) throw new Error(`${name} is not set, in the environment or in frontend/.env`);
  return value;
}

export const anthropicKey = () => secret("ANTHROPIC_API_KEY");
export const elevenToken = () => secret("ELEVEN_LABS_TOKEN");

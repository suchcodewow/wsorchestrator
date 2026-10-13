import { readFileSync } from "node:fs";
import { ENV_FILE, SFX_MODEL, TTS_MODEL, VOICE_ID, VOICE_SETTINGS } from "./config.js";

const API = "https://api.elevenlabs.io/v1";

/** Reads ELEVEN_LABS_TOKEN from the environment or frontend/.env. Never logged or written anywhere. */
function apiKey(): string {
  const fromEnv = process.env.ELEVEN_LABS_TOKEN;
  if (fromEnv) return fromEnv;
  const m = readFileSync(ENV_FILE, "utf8").match(/^ELEVEN_LABS_TOKEN=(.*)$/m);
  const value = m?.[1].trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`ELEVEN_LABS_TOKEN not found in the environment or ${ENV_FILE}`);
  return value;
}

async function post(pathAndQuery: string, body: unknown): Promise<Response> {
  const res = await fetch(`${API}${pathAndQuery}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${pathAndQuery.split("?")[0]} -> HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return res;
}

export type Speech = { audio: Buffer; characters: string[]; starts: number[]; ends: number[] };

/** Text to speech in the cloned voice, with character-level timestamps. */
export async function speak(text: string, previousText?: string, nextText?: string): Promise<Speech> {
  const res = await post(`/text-to-speech/${VOICE_ID}/with-timestamps?output_format=mp3_44100_128`, {
    text,
    model_id: TTS_MODEL,
    voice_settings: VOICE_SETTINGS,
    ...(previousText ? { previous_text: previousText } : {}),
    ...(nextText ? { next_text: nextText } : {}),
  });
  const j = (await res.json()) as {
    audio_base64: string;
    alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
  };
  return {
    audio: Buffer.from(j.audio_base64, "base64"),
    characters: j.alignment.characters,
    starts: j.alignment.character_start_times_seconds,
    ends: j.alignment.character_end_times_seconds,
  };
}

/** Generates a sound effect from a text prompt. */
export async function soundEffect(prompt: string, durationSeconds: number, loop = false): Promise<Buffer> {
  const res = await post(`/sound-generation?output_format=mp3_44100_128`, {
    text: prompt,
    model_id: SFX_MODEL,
    duration_seconds: durationSeconds,
    prompt_influence: 0.5,
    loop,
  });
  return Buffer.from(await res.arrayBuffer());
}

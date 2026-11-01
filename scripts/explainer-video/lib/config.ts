import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ENV_FILE = path.resolve(ROOT, "../../frontend/.env");

// Who narrates each language. A voice ID is not a secret.
export const VOICES = {
  en: "IsDb1iFFxgGkl2SQ8Dli", // Shawn Pearson's professional voice clone
  es: "6wMKsI8ig8FZUfpyZDIY", // Nadia Lucia - Narrator, from the ElevenLabs library: neutral Latin American Spanish
} as const;
export type NarrationLanguage = keyof typeof VOICES;
export const TTS_MODEL = "eleven_multilingual_v2";
export const SFX_MODEL = "eleven_text_to_sound_v2";
export const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true };


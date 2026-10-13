import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ENV_FILE = path.resolve(ROOT, "../../frontend/.env");

// Shawn Pearson's professional voice clone. A voice ID is not a secret.
export const VOICE_ID = "IsDb1iFFxgGkl2SQ8Dli";
export const TTS_MODEL = "eleven_multilingual_v2";
export const SFX_MODEL = "eleven_text_to_sound_v2";
export const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true };


/**
 * Why a Mimir Studio job failed, in a line someone can act on. A job's `error`
 * holds what went wrong as the studio caught it, often a provider's raw JSON;
 * this reads the cause out of it for the pages that show jobs, so rows stored
 * before the studio named its causes read just as well. Pure, so the client
 * components can use it.
 */

/** A translation that fails leaves the English video up; the studio says so first. */
const TRANSLATION = /^The (.+?) version could not be made, so it plays in English: /s;

/** Causes worth naming, tried in order against the whole error. */
const CAUSES: [RegExp, string][] = [
  [/credit balance is too low to access the Anthropic API/i, "The Anthropic API account is out of credit."],
  [/quota_exceeded|exceeds your quota/i, "The ElevenLabs account is out of credits."],
  [/ElevenLabs[^\n]*HTTP 401[^\n]*(invalid_api_key|api key)/i, "ElevenLabs refused the API key."],
  [/ElevenLabs[^\n]*HTTP 402|payment_required/i, "ElevenLabs needs a paid plan for this voice or model."],
  [/ElevenLabs[^\n]*(voice_not_found|HTTP 404)/i, "ElevenLabs could not find the narrator's voice."],
  [/"type":"overloaded_error"|\b529\b/, "The Claude API was overloaded."],
  [/"type":"rate_limit_error"/, "The Claude API rate-limited the job."],
  [/"type":"authentication_error"/, "The Claude API refused the API key."],
];

/** The `message` inside a provider's JSON error, when there is one. */
function providerMessage(error: string): string | null {
  const m = error.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  return m ? m[1]!.replace(/\\"/g, '"') : null;
}

/** A specific reason for a failed job, from its stored error; null when it has none. */
export function failureReason(error: string | null): string | null {
  if (!error?.trim()) return null;
  const translation = error.match(TRANSLATION);
  const rest = translation ? error.slice(translation[0].length) : error;
  const cause =
    CAUSES.find(([pattern]) => pattern.test(rest))?.[1] ??
    providerMessage(rest) ??
    rest.replace(/^(\w*Error: )+/, "").trim();
  return translation ? `${translation[1]} failed, so it plays in English. ${cause}` : cause;
}

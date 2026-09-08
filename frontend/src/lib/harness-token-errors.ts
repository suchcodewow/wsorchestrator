/** The sentence shown for each way a saved token can fail. */

export type HarnessTokenError =
  | "malformed"
  | "invalid_token"
  | "harness_error"
  | "unreachable"
  | "too_many"
  | "duplicate"
  | "no_key"
  | "not_found"
  | "unreadable";

export const STATUS_FOR: Record<HarnessTokenError, number> = {
  malformed: 400,
  invalid_token: 409,
  duplicate: 409,
  too_many: 409,
  unreadable: 409,
  not_found: 404,
  harness_error: 502,
  unreachable: 504,
  no_key: 503,
};

export const MESSAGES: Record<HarnessTokenError, string> = {
  malformed:
    "A Harness token starts with pat. or sat. and has four dot-separated parts.",
  invalid_token:
    "Harness rejected that token — it may be wrong, revoked, expired, or for another cluster.",
  harness_error: "Harness couldn't answer just now — try again in a moment.",
  unreachable: "Couldn't reach Harness — check the network and try again.",
  duplicate: "That token is already saved below.",
  too_many: "Remove a saved token before adding another.",
  no_key:
    "This deployment has no encryption key, so a token can't be stored.",
  not_found: "That token was already removed — reload the page.",
  unreadable:
    "This token can no longer be decrypted, so remove it and paste it again.",
};

export function messageFor(error: unknown, status: number, detail?: unknown) {
  const known = MESSAGES[error as HarnessTokenError];
  if (!known) return `Something went wrong (${status}).`;
  return typeof detail === "string" && detail.trim().length > 0
    ? `${known} Harness said: ${detail.trim()}`
    : known;
}

/**
 * What can go wrong saving or re-checking a Harness token, as a status and as a
 * sentence.
 *
 * Pure and shared: the route picks the status, the tab prints the message, and
 * keeping both here is what stops the two drifting into disagreeing about what
 * an error means.
 */

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
  // The request was fine; the credential in it was not. Refused on a fact about
  // the token rather than on its shape, which is what 409 says.
  invalid_token: 409,
  duplicate: 409,
  too_many: 409,
  unreadable: 409,
  not_found: 404,
  // Harness answered, and the answer was its own failure — not ours to fix.
  harness_error: 502,
  unreachable: 504,
  // A deployment is missing its encryption key. Nothing the user can do.
  no_key: 503,
};

export const MESSAGES: Record<HarnessTokenError, string> = {
  malformed:
    "That doesn't look like a Harness token. They start with pat. or sat. and have four dot-separated parts.",
  invalid_token:
    "Harness rejected that token. It may be wrong, revoked, expired, or for a different Harness cluster.",
  harness_error: "Harness couldn't answer just now. Try again in a moment.",
  unreachable: "Couldn't reach Harness. Check the network and try again.",
  duplicate: "That token is already saved below.",
  too_many: "You've saved as many tokens as an account can hold. Remove one first.",
  no_key:
    "This deployment has no encryption key configured, so a token can't be stored. An administrator needs to set AUTH_SECRET or HARNESS_TOKEN_ENC_KEY.",
  not_found: "That token was already removed. Reload the page.",
  unreadable:
    "This token can no longer be decrypted — the deployment's encryption key changed. Remove it and paste the token again.",
};

/** The message for whatever a route reported, with a fallback for the unforeseen. */
export function messageFor(error: unknown, status: number, detail?: unknown) {
  const known = MESSAGES[error as HarnessTokenError];
  if (!known) return `Something went wrong (${status}).`;
  // Harness's own words, when there are any, after ours. Their message names the
  // reason a token was refused — expired versus revoked, say — which is exactly
  // what somebody needs and exactly what a generic sentence can't say.
  return typeof detail === "string" && detail.trim().length > 0
    ? `${known} Harness said: ${detail.trim()}`
    : known;
}

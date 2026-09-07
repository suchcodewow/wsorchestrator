/**
 * What can stop a deploy before it starts, as a status and as a sentence.
 *
 * Only the failures that mean *nothing was attempted*. Once the organization
 * exists the deploy always succeeds as a request and reports per-entity outcomes
 * instead — a connector Harness refused is a line in the report, not a 502 that
 * throws away the twenty things that did land.
 *
 * Pure and shared with the client, the same arrangement `harness-token-errors`
 * uses: the route picks the status, the tab prints the message, and neither can
 * drift into disagreeing about what an error means.
 */

export type DeployError =
  /** No such saved token for this user. */
  | "not_found"
  /** The stored token cannot be decrypted — the encryption key changed. */
  | "unreadable"
  /** Harness rejected the token outright. */
  | "invalid_token"
  /** The token is real but does not administer the account. */
  | "not_permitted"
  /** The organization name is empty, or has no legal identifier in it. */
  | "invalid_name"
  /** An organization with that identifier is already there. */
  | "org_exists"
  /** Harness refused to create the organization, so nothing else was tried. */
  | "org_failed"
  /** Harness answered with its own failure. */
  | "harness_error"
  /** Harness could not be reached. */
  | "unreachable";

export const STATUS_FOR: Record<DeployError, number> = {
  not_found: 404,
  unreadable: 409,
  invalid_token: 409,
  // Refused on a fact about the credential rather than on the request's shape.
  not_permitted: 403,
  invalid_name: 400,
  org_exists: 409,
  org_failed: 502,
  harness_error: 502,
  unreachable: 504,
};

export const MESSAGES: Record<DeployError, string> = {
  not_found: "That token was already removed. Reload the page.",
  unreadable:
    "This token can no longer be decrypted — the deployment's encryption key changed. Remove it and paste the token again.",
  invalid_token:
    "Harness rejected that token. It may have been revoked or expired since it was last checked.",
  not_permitted:
    "That token no longer administers the account, so it can't create an organization. Re-check it to see what it holds now.",
  invalid_name:
    "That name has no letters, digits, or underscores in it, so there is no identifier Harness would accept. Try another.",
  org_exists:
    "An organization with that identifier already exists in the account. Pick a different name, or delete the existing one first.",
  org_failed:
    "Harness would not create the organization, so nothing else was deployed.",
  harness_error: "Harness couldn't answer just now. Try again in a moment.",
  unreachable: "Couldn't reach Harness. Check the network and try again.",
};

/** The message for whatever the route reported, with a fallback for the unforeseen. */
export function messageFor(error: unknown, status: number, detail?: unknown) {
  const known = MESSAGES[error as DeployError];
  if (!known) return `Something went wrong (${status}).`;
  // Harness's own words after ours, when there are any: their message names the
  // reason — a name that clashes, a scope still propagating — which is exactly
  // what somebody needs and exactly what a generic sentence cannot say.
  return typeof detail === "string" && detail.trim().length > 0
    ? `${known} Harness said: ${detail.trim()}`
    : known;
}

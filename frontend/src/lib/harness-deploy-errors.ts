/** The sentence shown for each way a deploy can fail. */

export type DeployError =
  | "not_found"
  | "unreadable"
  | "invalid_token"
  | "not_permitted"
  | "invalid_name"
  | "org_exists"
  | "org_failed"
  | "harness_error"
  | "unreachable";

export const STATUS_FOR: Record<DeployError, number> = {
  not_found: 404,
  unreadable: 409,
  invalid_token: 409,
  not_permitted: 403,
  invalid_name: 400,
  org_exists: 409,
  org_failed: 502,
  harness_error: 502,
  unreachable: 504,
};

export const MESSAGES: Record<DeployError, string> = {
  not_found: "That token was already removed — reload the page.",
  unreadable:
    "This token can no longer be decrypted, so remove it and paste it again.",
  invalid_token:
    "Harness rejected that token — it may have been revoked or expired.",
  not_permitted:
    "That token no longer administers the account, so it can't create an organization.",
  invalid_name:
    "That name needs a letter, digit, or underscore in it.",
  org_exists:
    "An organization with that identifier already exists, so pick a different name.",
  org_failed:
    "Harness would not create the organization, so nothing else was deployed.",
  harness_error: "Harness couldn't answer just now — try again in a moment.",
  unreachable: "Couldn't reach Harness — check the network and try again.",
};

export function messageFor(error: unknown, status: number, detail?: unknown) {
  const known = MESSAGES[error as DeployError];
  if (!known) return `Something went wrong (${status}).`;
  return typeof detail === "string" && detail.trim().length > 0
    ? `${known} Harness said: ${detail.trim()}`
    : known;
}

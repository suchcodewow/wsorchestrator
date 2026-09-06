import { MAX_TEMPLATE_SOURCES } from "@/db/schema";
import type { CheckError } from "@/lib/harness-platform";

/**
 * What can go wrong saving a template source, as a status and as a sentence.
 *
 * Pure and shared, and a module of its own for a reason that is not only tidiness:
 * `@/lib/harness-templates` is `server-only`, so a client component importing
 * `messageFor` from there would fail to build. The route picks the status, the
 * tab prints the message, and keeping both here is what stops the two drifting
 * into disagreeing about what an error means. Same arrangement as
 * `@/lib/harness-token-errors`.
 */
export type TemplateSourceError =
  | CheckError
  /** Harness has no such organization, or the token cannot see it. */
  | "org_not_found"
  /** Harness has no such project in that organization. */
  | "project_not_found"
  /** This token is already saved against that org and project. */
  | "duplicate"
  | "too_many"
  /** No encryption key configured, so nothing can be stored safely. */
  | "no_key"
  | "not_found";

export const STATUS_FOR: Record<TemplateSourceError, number> = {
  malformed: 400,
  // The request was fine; what it named was not. Refused on a fact rather than
  // on its shape, which is what 409 says.
  invalid_token: 409,
  org_not_found: 409,
  project_not_found: 409,
  duplicate: 409,
  too_many: 409,
  not_found: 404,
  // Harness answered, and the answer was its own failure — not ours to fix.
  harness_error: 502,
  unreachable: 504,
  // A deployment is missing its encryption key. Nothing the user can do.
  no_key: 503,
};

export const MESSAGES: Record<TemplateSourceError, string> = {
  malformed:
    "That doesn't look like a Harness token. They start with pat. or sat. and have four dot-separated parts.",
  invalid_token:
    "Harness rejected that token. It may be wrong, revoked, expired, or for a different Harness cluster.",
  org_not_found:
    "Harness has no organization with that identifier, or this token cannot see it.",
  project_not_found:
    "Harness has no project with that identifier in that organization, or this token cannot see it.",
  duplicate: "That token is already saved for that organization and project.",
  too_many: `The site holds as many template sources as it can (${MAX_TEMPLATE_SOURCES}). Remove one first.`,
  harness_error: "Harness couldn't answer just now. Try again in a moment.",
  unreachable: "Couldn't reach Harness. Check the network and try again.",
  no_key:
    "This deployment has no encryption key configured, so a token can't be stored. An administrator needs to set AUTH_SECRET or HARNESS_TOKEN_ENC_KEY.",
  not_found: "That source was already removed. Reload the page.",
};

/** The sentence for whatever a route reported, with Harness's own words after it. */
export function messageFor(error: unknown, status: number, detail?: unknown) {
  const known = MESSAGES[error as TemplateSourceError];
  if (!known) return `Something went wrong (${status}).`;
  // Harness's own message names the reason something was refused — expired
  // versus revoked, missing versus invisible — which no generic sentence can.
  return typeof detail === "string" && detail.trim().length > 0
    ? `${known} Harness said: ${detail.trim()}`
    : known;
}

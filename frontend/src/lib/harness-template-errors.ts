/** The sentence shown for each way a template source can fail. */

import { MAX_TEMPLATE_SOURCES } from "@/db/schema";
import type { CheckError } from "@/lib/harness-platform";

export type TemplateSourceError =
  | CheckError
  | "org_not_found"
  | "project_not_found"
  | "duplicate"
  | "too_many"
  | "no_key"
  | "not_found";

export const STATUS_FOR: Record<TemplateSourceError, number> = {
  malformed: 400,
  invalid_token: 409,
  org_not_found: 409,
  project_not_found: 409,
  duplicate: 409,
  too_many: 409,
  not_found: 404,
  harness_error: 502,
  unreachable: 504,
  no_key: 503,
};

export const MESSAGES: Record<TemplateSourceError, string> = {
  malformed:
    "A Harness token starts with pat. or sat. and has four dot-separated parts.",
  invalid_token:
    "Harness rejected that token — it may be wrong, revoked, expired, or for another cluster.",
  org_not_found:
    "Harness has no organization with that identifier, or this token cannot see it.",
  project_not_found:
    "Harness has no project with that identifier in that organization, or this token cannot see it.",
  duplicate: "That token is already saved for that organization and project.",
  too_many: `Remove a template source before adding another (${MAX_TEMPLATE_SOURCES} is the limit).`,
  harness_error: "Harness couldn't answer just now — try again in a moment.",
  unreachable: "Couldn't reach Harness — check the network and try again.",
  no_key:
    "This deployment has no encryption key, so a token can't be stored.",
  not_found: "That source was already removed — reload the page.",
};

export function messageFor(error: unknown, status: number, detail?: unknown) {
  const known = MESSAGES[error as TemplateSourceError];
  if (!known) return `Something went wrong (${status}).`;
  return typeof detail === "string" && detail.trim().length > 0
    ? `${known} Harness said: ${detail.trim()}`
    : known;
}

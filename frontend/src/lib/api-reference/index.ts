/**
 * The catalog behind the public API reference at /api.
 *
 * Every exported method of every `src/app/api/**\/route.ts` has exactly one
 * entry here, and `token` is false exactly where the handler calls `auth()`
 * itself. `test/unit/api-reference.test.ts` holds both to the route files, so
 * a new route fails the unit suite until it is documented here.
 */

import { ACCOUNT_GROUPS } from "./account";
import { ADMIN_GROUPS } from "./admin";
import { CONTENT_GROUPS } from "./content";
import { EVENT_GROUPS } from "./events";
import type { EndpointGroup } from "./types";

export * from "./types";

const byId = (groups: EndpointGroup[], id: string): EndpointGroup => {
  const group = groups.find((g) => g.id === id);
  if (!group) throw new Error(`no API reference group "${id}"`);
  return group;
};

const ALL = [...ACCOUNT_GROUPS, ...EVENT_GROUPS, ...CONTENT_GROUPS, ...ADMIN_GROUPS];

/** In reading order: yourself, then events, then content, then administration. */
export const GROUPS: EndpointGroup[] = [
  "account",
  "events",
  "attendees",
  "components",
  "lab-workshops",
  "lab-guides",
  "lab-images",
  "harness-tokens",
  "my-org-secrets-templates",
  "event-settings",
  "cloud-status",
  "scheduler",
  "cohorts",
  "evals",
  "users",
  "platform",
  "audit",
  "internal",
].map((id) => byId(ALL, id));

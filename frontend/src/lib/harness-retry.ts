/**
 * How a Harness HTTP reply is classified: worth another attempt, already
 * satisfied, or a real refusal.
 *
 * Pure, and deliberately not `server-only` — the same reason
 * `harness-identifier.ts` isn't. These two predicates decide whether a deploy
 * survives a hiccup or dies on it, and while they lived inside
 * `harness-deploy.ts` they could not be tested at all: that module imports
 * `server-only` and the database, so loading it outside a request is impossible.
 * A rule that decides whether a workshop fails should not be the one rule
 * nothing can exercise.
 *
 * The runner keeps its own copy in `runner/src/harness.ts` — a separate service
 * with its own build, where a copy of twenty lines beats a package between them.
 * The two are meant to agree, and `harness-errors.test.ts` runs one corpus of
 * real production replies through both so they cannot quietly drift.
 */

/**
 * Worth trying again: Harness's own 5xx and the rate limiter.
 *
 * A 500 straight after creating a scope is not the fatal condition it looks
 * like — Harness propagates a new organization asynchronously, and the first
 * write into it can land before the RBAC machinery has caught up.
 */
export const isRetryable = (status: number) => status === 429 || status >= 500;

/**
 * Refusals that mean "what you asked for is already true" but say so in wording
 * the generic duplicate check misses.
 *
 * `already part of user group` is the expensive one. `POST /ng/api/user/users`
 * is not atomic on Harness's side: the membership and the role binding both
 * land, and *then* the reply comes back 400, double-wrapped as
 *
 *   Invalid request: Invalid format of YAML payload: HTTP Error Status
 *   (400 - Invalid Format) received. Invalid request: User <uuid> is already
 *   part of User Group _project_all_users
 *
 * — which names no duplicate and reads like a malformed payload. It has killed
 * two runner provisions mid-roster (2026-08-21 at `_organization_all_users`,
 * 2026-09-07 at `_project_all_users`), and both times the binding it claimed to
 * refuse was present afterwards. Either group name can appear, so the match is
 * scope-agnostic.
 *
 * Every entry is a string some run actually failed on. Guessing at signatures is
 * how a genuine refusal gets swallowed, so each one stays pinned verbatim in the
 * test corpus.
 */
const ALREADY_SATISFIED = [/already part of user group/i];

/** Harness reports "already exists" as a 409 sometimes and a 400 others. */
export const isDuplicate = (status: number, body: string) =>
  status === 409 ||
  /DUPLICATE_FIELD|already exists|duplicate/i.test(body) ||
  ALREADY_SATISFIED.some((sig) => sig.test(body));

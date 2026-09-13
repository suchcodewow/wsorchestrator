/**
 * Reading a provider's failure text and deciding what it means: wait and try
 * again, move to another zone, or stop and report.
 *
 * These predicates are the runner's most consequential logic and the least
 * visible. A missing substring here does not misbehave subtly — it fails a whole
 * workshop, in front of a room, on a condition that would have cleared itself in
 * ninety seconds. Nearly every provisioning failure this project has had traces
 * to one of these lists not containing a string some cloud decided to use.
 *
 * They live apart from `run.ts` for one reason: `run.ts` reaches the database and
 * the cloud SDKs at import time, so nothing in it can be exercised without a
 * live environment. Pure functions in a pure module can be, and
 * `classify.test.ts` runs every string a real run has ever failed on through
 * them. That corpus is the point — each entry below is a scar, and the test is
 * what stops it reopening.
 *
 * Matching is substring-on-lowercase throughout: provider messages carry
 * request ids, ARNs and resource names, so an exact match would never hit.
 */

/** Lowercased haystack, so callers do not each have to remember to fold case. */
const has = (text: string, signatures: readonly string[]): boolean => {
  const t = text.toLowerCase();
  return signatures.some((s) => t.includes(s));
};

/**
 * Substrings that mark a GKE apply failure as "this zone can't give us the
 * cluster right now" rather than a real config error, so the runner should try
 * another zone rather than give up. Two shapes:
 *   - an explicit GCE stockout (the zone immediately reports no room), and
 *   - a create that ran past `create_timeout` (a capacity-starved zone where
 *     GKE keeps retrying the initial node internally instead of erroring —
 *     Terraform surfaces this as a "timeout while waiting for state" / context
 *     deadline). Bounding the timeout in the module is what turns that silent
 *     hang into a prompt, catchable failure.
 */
export const GKE_CAPACITY_SIGNATURES = [
  "does not have enough resources available",
  "zone_resource_pool_exhausted",
  "resource pool exhausted",
  "try a different location",
  "timeout while waiting for state to become",
  "context deadline exceeded",
] as const;

export function isGkeCapacityError(text: string): boolean {
  return has(text, GKE_CAPACITY_SIGNATURES);
}

/**
 * Signatures AWS Organizations returns when the organization is already busy
 * with another account operation.
 *
 * The management account is shared by every AWS run, and Organizations
 * processes account creation one at a time across the whole org — so two
 * workshops starting together contend on it even though their state, their
 * accounts, and everything else about them are separate. The AWS provider
 * retries only `FinalizingOrganizationException` itself; a
 * `ConcurrentModificationException` is modelled as a client fault and is not
 * retried by the SDK either, so without this the second workshop of a pair
 * just fails.
 */
export const AWS_ORG_CONTENTION_SIGNATURES = [
  "concurrentmodificationexception",
  "finalizingorganizationexception",
  "toomanyrequestsexception",
  "throttlingexception",
] as const;

/**
 * Signatures a member account returns while it is still being switched on.
 *
 * Organizations reports an account ACTIVE the moment CreateAccount finishes,
 * but only IAM is usable that early: for the first few minutes every EC2 call
 * comes back `OptInRequired` ("You are not subscribed to this service"). The
 * apply that creates the account goes straight on to build the cluster inside
 * it, so it walks into exactly that window — the attendee users and the
 * cluster's IAM roles land, and everything touching EC2 fails. Waiting and
 * re-applying resumes there.
 *
 * `InvalidClientTokenId` is the same window seen from IAM rather than EC2. The
 * member account's access key exists the moment Terraform creates it, but STS
 * does not recognise it globally for another minute or two, so the next call is
 * refused as "The security token included in the request is invalid". That reads
 * like a bad credential and is not one — it is the credential we just made, not
 * yet propagated. Two runs died on it while an `OptInRequired` beside it was
 * being patiently retried (2026-08-23 `aws`, 2026-08-25 `nationwide-insurnace`):
 * whichever resource Terraform reached first decided whether the run waited or
 * gave up.
 *
 * Deliberately *without* a bare "accessdenied". A genuine policy mistake says
 * that too, and a closing account says it for ten minutes straight — spending
 * the whole warm-up budget before failing would bury the real cause instead of
 * fixing it. See `classify.test.ts`, which pins that exclusion.
 */
export const AWS_ACCOUNT_WARMUP_SIGNATURES = [
  "optinrequired",
  "not subscribed to this service",
  "invalidclienttokenid",
] as const;

/** Why an AWS apply is worth another attempt rather than being a real failure. */
export type AwsRetryKind = "contention" | "warmup";

export function awsRetryKind(text: string): AwsRetryKind | null {
  if (has(text, AWS_ORG_CONTENTION_SIGNATURES)) return "contention";
  if (has(text, AWS_ACCOUNT_WARMUP_SIGNATURES)) return "warmup";
  return null;
}

/**
 * Waits between attempts, counted per reason so a run that hits both still gets
 * a full budget for each. Both are minutes rather than seconds: one waits on
 * another account creation finishing, the other on AWS finishing this one.
 */
export const AWS_RETRY_DELAYS_MS: Record<AwsRetryKind, number[]> = {
  contention: [60_000, 120_000, 240_000],
  warmup: [60_000, 120_000, 180_000, 300_000],
};

/**
 * What to do with an AWS apply that just exited non-zero, given how many
 * attempts each reason has already spent.
 *
 * Separate from the applying itself because the answer decides two things, not
 * one: whether to go round again, and whether the attempt's stderr was a
 * failure. A retried attempt's diagnostics describe a condition that cleared
 * itself, and logging those in red is what makes a healthy AWS run look broken
 * — every run trips the warm-up race once. `run.ts` writes them at the
 * severity this outcome implies.
 */
export type AwsAttemptOutcome =
  | { action: "retry"; kind: AwsRetryKind; delayMs: number }
  | { action: "fail" };

export function awsAttemptOutcome(
  stderr: string,
  spent: Readonly<Record<AwsRetryKind, number>>,
): AwsAttemptOutcome {
  const kind = awsRetryKind(stderr);
  if (kind === null) return { action: "fail" };

  const delayMs = AWS_RETRY_DELAYS_MS[kind][spent[kind]];
  if (delayMs === undefined) return { action: "fail" };

  return { action: "retry", kind, delayMs };
}

/**
 * Destroy failures that describe a condition the cloud clears by itself, so the
 * reaper should take one more attempt instead of stopping for a person.
 *
 * `destroy-policy.ts` is deliberately a one-attempt policy, and this list is the
 * only exception to it. The bar is therefore not "might work next time" — it is
 * a message whose mechanism is *understood*, with runs on the record showing the
 * next attempt succeeding.
 *
 * One entry, and it has both. `aws_organizations_account` with
 * `close_on_deletion = true` calls CloseAccount and then waits ten minutes for
 * the account to stop reading as live. What it waits for is not the account
 * leaving the organization — a closed account stays in the org, SUSPENDED, for
 * about ninety days, and if that were the condition this really would be
 * hopeless. It is not: provider 5.100.0's `findAccountByID` maps SUSPENDED to
 * NotFound, so the wait is satisfied the moment the close lands, and a later
 * refresh drops the resource from state and makes the destroy a no-op. AWS takes
 * a bit over ten minutes to get there. The reaper ticks every five.
 *
 * Production agrees, five times out of five: `jdb-test-workshop` (2026-08-27)
 * hit this at 19:12:46 and was `destroyed` at 19:13:53, and `aws`,
 * `nationwide-insurnace` and `aws-platform-team` (twice) all recovered on the
 * attempt straight after. The reading this replaces — that the message was
 * permanent — cost three runs their automatic teardown before it was caught, and
 * attributed to this string a 572-attempt loop that belonged to a different
 * failure on `aws-platform` entirely.
 *
 * Note how narrowly it is still written. `GKE_CAPACITY_SIGNATURES` above
 * contains "timeout while waiting for state to become", which means move to
 * another zone at apply time; this is "timeout while waiting for resource to be
 * gone", which means tick the teardown again. Six words apart, different
 * machinery. Both fixtures assert against the other's classifier for exactly
 * that reason — collapsing either into the common prefix would compile, read
 * fine, and quietly swap them.
 */
export const SELF_CLEARING_DESTROY_SIGNATURES = [
  "timeout while waiting for resource to be gone",
] as const;

export function isSelfClearingDestroyFailure(text: string): boolean {
  return has(text, SELF_CLEARING_DESTROY_SIGNATURES);
}

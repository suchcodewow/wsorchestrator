/**
 * How many times, and how often, a failed teardown is retried before it stops
 * and asks for a person.
 *
 * The reaper used to catch every destroy failure, log "will retry", and leave the
 * run in `destroying` for the next tick — with no cap and no backoff. On a
 * five-minute cron that is 288 attempts a day, forever. Run `aws-platform` logged
 * 572 of them over two days against a destroy that could not succeed on any of
 * them (see `PERMANENT_DESTROY_SIGNATURES`), and `zone-b-dfae0a` sat in
 * `destroying` from 2026-08-06. Neither ever appeared as a problem anywhere,
 * because a run that is "still retrying" looks the same as one making progress.
 *
 * That is the failure this module exists to make impossible. Three rules:
 *
 *   1. A failure that cannot succeed stops immediately. No point spending the
 *      budget to reach a known answer.
 *   2. Everything else backs off exponentially, so a genuinely transient cause
 *      (Workspace lagging an account delete, AWS eventual consistency, a state
 *      lock from a killed container) still clears on its own without hammering
 *      the provider every five minutes.
 *   3. The budget is finite. When it runs out the run goes to `destroy_failed`
 *      and stays there until someone looks at it.
 *
 * Rule 3 is the one that matters, and it is a deliberate trade. A stuck teardown
 * is not harmless — it holds a cloud account that is still costing money — so the
 * outcome that needs to be loud is "nobody knows this is stuck", not "it stopped
 * trying". A terminal state is visible on the page and in the status badge. An
 * infinite loop is visible nowhere, which is why this went unnoticed for a month.
 *
 * Pure arithmetic and one predicate, so `destroy-policy.test.ts` can exercise the
 * whole ladder without a database or a cloud.
 */
import { isPermanentDestroyFailure } from "./classify.js";

/**
 * Failed attempts allowed before a teardown is handed to a human.
 *
 * Eight, which with the backoff below spans about ten and a half hours — a full
 * working day of self-healing. Long enough that anything eventually-consistent
 * has resolved, short enough that a genuinely wedged teardown surfaces the same
 * day rather than after a month of silence.
 */
export const MAX_DESTROY_ATTEMPTS = 8;

/**
 * First backoff, in seconds. One reaper tick — `reaper_schedule` defaults to
 * every five minutes — because a shorter delay cannot be honoured: the run
 * simply is not looked at again until the next tick.
 */
export const DESTROY_BACKOFF_BASE_SECONDS = 5 * 60;

/**
 * Ceiling on a single wait. Reached at attempt 7 (320 minutes), so it does not
 * bind at the current cap — it is here so that raising `MAX_DESTROY_ATTEMPTS`
 * lengthens the budget by adding attempts rather than by doubling into
 * multi-day gaps between them.
 */
export const DESTROY_BACKOFF_MAX_SECONDS = 6 * 60 * 60;

/** What the reaper should do after a destroy attempt has failed. */
export type DestroyDecision =
  /** Try again, no earlier than `delaySeconds` from now. */
  | { kind: "retry"; attempts: number; delaySeconds: number }
  /** Stop. `permanent` = cannot ever work; `exhausted` = out of budget. */
  | { kind: "give-up"; attempts: number; reason: "permanent" | "exhausted" };

/**
 * Seconds to wait after `attempts` consecutive failures: 5m, 10m, 20m, 40m, 80m,
 * 160m, 320m, then the ceiling.
 *
 * `attempts` counts failures *including* the one that just happened, so it is
 * always >= 1 when this is called and the first wait is the base.
 */
export function destroyBackoffSeconds(attempts: number): number {
  const doublings = Math.max(0, attempts - 1);
  // Clamped before the shift: 2 ** 1024 is Infinity, and a run whose counter had
  // somehow got large would otherwise produce a NaN/Infinity delay and a
  // timestamp Postgres rejects — a crash in the error handler, which is the
  // worst possible place for one.
  const grown =
    DESTROY_BACKOFF_BASE_SECONDS * 2 ** Math.min(doublings, 30);
  return Math.min(grown, DESTROY_BACKOFF_MAX_SECONDS);
}

/**
 * Decide what happens after a destroy attempt failed with `message`.
 *
 * `priorAttempts` is the number of failures recorded *before* this one, i.e. the
 * stored counter as it was read at the start of the attempt.
 */
export function nextDestroyStep(
  priorAttempts: number,
  message: string,
): DestroyDecision {
  const attempts = priorAttempts + 1;

  // Checked before the budget, so the reason reported is the useful one: "this
  // cannot work" rather than "it did not work eight times".
  if (isPermanentDestroyFailure(message)) {
    return { kind: "give-up", attempts, reason: "permanent" };
  }
  if (attempts >= MAX_DESTROY_ATTEMPTS) {
    return { kind: "give-up", attempts, reason: "exhausted" };
  }
  return {
    kind: "retry",
    attempts,
    delaySeconds: destroyBackoffSeconds(attempts),
  };
}

/**
 * The line written to the run log, and — when giving up — stored as the run's
 * error and shown on its page. It has to answer "what do I do about this?" on
 * its own, because it is the only thing a person sees when they open a run that
 * has stopped tearing itself down.
 */
export function describeDestroyDecision(
  decision: DestroyDecision,
  message: string,
): string {
  if (decision.kind === "retry") {
    const minutes = Math.round(decision.delaySeconds / 60);
    return (
      `destroy failed (attempt ${decision.attempts} of ${MAX_DESTROY_ATTEMPTS}), ` +
      `retrying in ~${minutes}m: ${message}`
    );
  }
  if (decision.reason === "permanent") {
    return (
      `destroy cannot succeed and will not be retried: ${message}\n` +
      "This failure is terminal by construction — retrying reaches the same " +
      "result. The most common cause is an AWS member account: closing one " +
      "starts a ~90-day suspension during which it stays in the organization, " +
      "so Terraform's 10-minute wait for it to disappear can never be " +
      "satisfied. The account itself is closed and no longer billing; what is " +
      "left is the state entry describing it. Clear it with " +
      "`tofu state rm aws_organizations_account.this` against this run's state " +
      "prefix, then retry the teardown to remove everything else."
    );
  }
  return (
    `destroy failed ${decision.attempts} times and has stopped retrying. ` +
    `Last error: ${message}\n` +
    "Nothing further is attempted automatically. This run may still own cloud " +
    "resources that are costing money, so it needs a look: fix the cause and " +
    "retry the teardown from this page."
  );
}

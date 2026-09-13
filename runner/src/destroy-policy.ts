/**
 * What happens when a teardown does not finish: it is flagged, and it is not
 * retried.
 *
 * The history is worth keeping, because this file has now been wrong in two
 * directions. First the reaper caught every destroy failure, logged "will retry",
 * and left the run in `destroying` for the next tick — no cap, no backoff. On a
 * five-minute cron that is 288 attempts a day, indefinitely: run `zone-b-dfae0a`
 * logged **9,482** failed attempts over 33 days, `aws-platform` 640 over three.
 * Then it grew an eight-attempt budget with exponential backoff, which bounded the
 * loop but kept the premise — that a failed teardown is probably worth repeating.
 *
 * The evidence says it usually is not. Every futile attempt is a Cloud Run
 * execution and a full `tofu init`/`destroy` cycle against live cloud APIs, and in
 * both real cases above every single attempt was doomed for the same reason as the
 * first. Cost control is the point of the reaper, so burning compute to re-derive a
 * known answer is the opposite of its job.
 *
 * So: one attempt. It works, or the run goes to `destroy_failed` with the reason
 * on the row, where a person sees it on the page and presses Retry teardown once
 * they have dealt with the cause. Three rules follow from that, and they are the
 * whole module:
 *
 *   1. **A failure flags.** No budget, no backoff, no second attempt.
 *   2. **A death flags too.** This is the part the old budget could not see. The
 *      attempt counter only advanced from the reaper's catch block, so a destroy
 *      that never *returned* — `tofu destroy` killed by the job's 1800s timeout,
 *      an OOM, a rolled deploy — left the counter untouched and was picked up
 *      again on the next tick, forever, with a full budget each time. Detection is
 *      `claimDestroy` in `db.ts`: the claim is written before the work starts, so
 *      finding a claim already set while holding the run's advisory lock proves
 *      the previous holder is gone.
 *   3. **A named self-clearing failure gets one more tick.** The third rule is
 *      the correction to the first two, and it is deliberately the narrowest of
 *      the three: it applies only to a message in
 *      `SELF_CLEARING_DESTROY_SIGNATURES`, only to a `failed` (never a `died`),
 *      and only up to `MAX_DESTROY_ATTEMPTS`.
 *
 * Rule 3 exists because rule 1 was applied to a failure that did not deserve it.
 * The AWS member-account close overruns its ten-minute wait by a minute or two
 * and then succeeds on the following tick — five runs on the record do exactly
 * that. Reading it as permanent stopped three teardowns dead, each leaving a
 * Harness org, an attendee account and a Google OU standing until someone noticed
 * and pressed a button. "Flag it and wait for a person" is the right default and
 * the wrong answer for a condition that resolves itself in ninety seconds.
 *
 * The trade in the other direction still stands, and rule 3 does not reopen it: an
 * *unnamed* transient failure — a state lock from a killed container, Workspace
 * lagging an account delete — still waits for a human, and the resources it holds
 * keep billing until then. That is acceptable only because the flag is *loud*: a
 * red badge on the run, an error on the row, and `make stuck-teardowns` exiting
 * non-zero. A silent loop was the more expensive failure, by 9,482 attempts to
 * one — which is why the exception is a list of strings with runs behind them
 * rather than a category like "timeouts are retryable".
 *
 * Pure string handling and arithmetic, so `destroy-policy.test.ts` exercises it
 * without a database or a cloud.
 */
import { isSelfClearingDestroyFailure } from "./classify.js";

/**
 * Total attempts a self-clearing failure may spend before it flags like any
 * other — the initial attempt plus two retries, at one tick (five minutes) each.
 *
 * Sized from the evidence rather than guessed: every recorded recovery landed on
 * the attempt immediately after the first, so two is already one more than has
 * ever been needed. The cap is what keeps rule 3 from becoming the unbounded loop
 * this module exists to prevent — if AWS ever stops closing accounts, this costs
 * three Cloud Run executions and then flags, instead of 288 a day.
 */
export const MAX_DESTROY_ATTEMPTS = 3;

/** Why a teardown stopped. Both flag; they differ only in what to tell someone. */
export type DestroyFailureKind =
  /** The destroy ran and returned an error. */
  | "failed"
  /** The destroy never returned — the process was killed mid-attempt. */
  | "died";

/** What the reaper should do about a teardown that did not finish. */
export type DestroyDecision =
  /** Hand it back for another tick; `note` goes on the row and in the log. */
  | { action: "retry"; note: string }
  /** Stop, and leave `reason` for a person. */
  | { action: "flag"; reason: string };

/**
 * The decision, given what happened and how many attempts this teardown has
 * already had (`attempts` counts the one that just failed — `claimDestroy`
 * increments before the work starts).
 *
 * A `died` never retries however it is classified. The signature is read from the
 * error text, and a death has no error text by construction, so an attempt killed
 * mid-close would otherwise be waved through as self-clearing on the strength of
 * a message it never got to print.
 */
export function decideDestroyFailure(
  kind: DestroyFailureKind,
  message: string,
  attempts: number,
): DestroyDecision {
  if (
    kind === "failed" &&
    isSelfClearingDestroyFailure(message) &&
    attempts < MAX_DESTROY_ATTEMPTS
  ) {
    return { action: "retry", note: describeDestroyRetry(message, attempts) };
  }
  return { action: "flag", reason: describeDestroyFailure(kind, message) };
}

/**
 * What a run says about itself while it waits for the next tick.
 *
 * Stored on the row, so it is what the page shows for the few minutes the run
 * sits in `destroying` having just failed. It has to distinguish itself from the
 * old "destroy failed, will retry" that this module spent two commits removing:
 * that line was written on all 9,482 attempts of an unbounded loop and meant
 * nothing. This one names the condition, says which attempt is next and out of
 * how many, and commits to flagging after that.
 */
export function describeDestroyRetry(message: string, attempts: number): string {
  return (
    `Teardown attempt ${attempts} did not finish, on a condition that clears ` +
    `itself — the reaper will try again within a few minutes (attempt ` +
    `${attempts + 1} of ${MAX_DESTROY_ATTEMPTS}). Closing an AWS member account ` +
    "usually takes a little longer than the provider's ten-minute wait; once " +
    "the close lands, the next destroy has nothing left to do. No action is " +
    "needed unless this run is still here after " +
    `${MAX_DESTROY_ATTEMPTS} attempts.\n\n${message}`
  );
}

/**
 * The reason stored on the run and written to its log.
 *
 * This is the entire handover. Nothing further is attempted automatically, so if
 * this text does not let someone work out what to do, the terminal state is just a
 * tidier dead end than the loop it replaced.
 */
export function describeDestroyFailure(
  kind: DestroyFailureKind,
  message: string,
): string {
  const head =
    kind === "died"
      ? "Teardown stopped: the previous attempt was killed before it could " +
        "finish or report anything.\n\nThe usual cause is time — a destroy that " +
        "runs past the reaper job's 1800s limit is terminated mid-flight. It is " +
        "not retried automatically, because an attempt that dies the same way " +
        "each time would loop forever without ever recording why. Some resources " +
        "may already be gone: destroy is idempotent, so retrying is safe and " +
        "picks up where this left off."
      : "Teardown failed and will not be retried automatically: " +
        // A destroy that exits non-zero having printed nothing to stderr is rare
        // but not impossible, and "failed automatically: " ending in a colon reads
        // like the reason was lost on the way here rather than never written.
        (message.trim().length > 0 ? message : "the destroy exited with an error but printed nothing.");

  return (
    head +
    "\n\nThis run may still own cloud resources that are costing money. Deal " +
    "with the cause, then press Retry teardown on this page."
  );
}

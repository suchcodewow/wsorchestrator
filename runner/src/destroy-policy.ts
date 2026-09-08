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
 * they have dealt with the cause. Two rules follow from that, and they are the
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
 *
 * The trade is deliberate and worth stating: a genuinely transient failure — a
 * state lock from a killed container, AWS eventual consistency, Workspace lagging
 * an account delete — no longer heals itself after five minutes. It waits for a
 * human instead, and the resources it holds keep billing until then. That is
 * acceptable only because the flag is *loud*: a red badge on the run, an error on
 * the row, and `make stuck-teardowns` exiting non-zero. A silent loop was the more
 * expensive failure, by 9,482 attempts to one.
 *
 * Pure string handling, so `destroy-policy.test.ts` exercises it without a
 * database or a cloud.
 */
import { isPermanentDestroyFailure } from "./classify.js";

/** Why a teardown stopped. Both flag; they differ only in what to tell someone. */
export type DestroyFailureKind =
  /** The destroy ran and returned an error. */
  | "failed"
  /** The destroy never returned — the process was killed mid-attempt. */
  | "died";

/**
 * Extra guidance for a failure whose cause is known and structural, appended to
 * the reason stored on the run.
 *
 * Only the AWS member-account close so far, and it earns its place: it is not a
 * fault anyone can fix by trying again or by changing the config.
 * `aws_organizations_account` with `close_on_deletion` calls CloseAccount and then
 * waits ten minutes for the account to leave the organization, but a closed AWS
 * account stays in the org, SUSPENDED, for about ninety days. The destroy cannot
 * complete, and the account is already closed and no longer billing — what is left
 * is a state entry describing it.
 */
function permanentHint(message: string): string {
  if (!isPermanentDestroyFailure(message)) return "";
  return (
    "\n\nThis one cannot be fixed by retrying. Closing an AWS member account " +
    "starts a ~90-day suspension during which it stays in the organization, so " +
    "Terraform's 10-minute wait for it to disappear can never be satisfied. The " +
    "account is already closed and is no longer billing; what is left is the " +
    "state entry describing it. Clear that with " +
    "`tofu state rm aws_organizations_account.this` against this run's state " +
    "prefix, then retry the teardown to remove everything else."
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
    "with the cause, then press Retry teardown on this page." +
    permanentHint(message)
  );
}

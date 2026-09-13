// Report every teardown that is not finishing, and say which kind of not
// finishing it is.
//
// The teardown loop that ran 9,482 times went unnoticed for a month because
// "retrying forever" and "making progress" were the same row: status
// `destroying`, no counter, no timestamp, nothing on any page. `destroy-policy.ts`
// removed the retry entirely — a teardown now gets one attempt and is flagged —
// but the flag is still only visible to somebody who looks, and so is a reaper
// that has stopped looking at all. This is the looking, in one command:
//
//   make stuck-teardowns          # against Cloud SQL, through the proxy
//   node frontend/scripts/stuck-teardowns.mjs   # with DATABASE_URL already set
//
// Exit codes, so this can be wired to a cron or a pipeline step later without
// changing anything here: 0 nothing to do, 1 something needs a person, 2 the
// report could not run and says nothing either way.
//
// Read-only. Every query is a select; nothing here changes a run's state, on
// purpose — deciding what to do about a wedged teardown needs the reason, and
// this tool's whole job is to hand over the reason.
import pg from "pg";

/**
 * How long a run may sit in `destroying` unclaimed before it counts as suspicious.
 *
 * The reaper ticks every five minutes, so a run that is due and unclaimed should
 * be claimed within one tick. An hour is twelve ticks' worth of grace: past that,
 * nothing is reaching this run, which is a statement about the reaper rather than
 * about the run.
 */
const SILENT_HOURS = Number(process.env.SILENT_HOURS ?? 1);

/**
 * How long a single claimed attempt may be outstanding.
 *
 * The reaper's Cloud Run job is capped at 1800s, so an attempt physically cannot
 * still be running after 30 minutes — the container is killed. 40 minutes allows
 * for the kill plus a tick to notice it and flag the run. A claim older than that
 * on a run still in `destroying` means nobody noticed, which means no tick has
 * reached this run since.
 */
const ATTEMPT_MINUTES = Number(process.env.ATTEMPT_MINUTES ?? 40);

/**
 * How long after a failed attempt a run may sit unclaimed before the silence is
 * worth reporting rather than expected.
 *
 * The reaper ticks every five minutes and `setDestroyRetry` leaves the run due
 * immediately, so the next attempt lands inside one tick. Fifteen covers a missed
 * tick and the clock skew between the two jobs without hiding a run that has
 * genuinely stopped being picked up.
 */
const RETRY_MINUTES = Number(process.env.RETRY_MINUTES ?? 15);

/**
 * Log lines a teardown attempt writes when it does not finish, across all four
 * generations of the policy.
 *
 * The pre-cap reaper wrote "destroy failed, will retry: …" on every tick, so these
 * patterns are what makes the history legible: a run whose stored counter says 2
 * and whose log holds 500 of these has been through the old loop, and the count is
 * the honest measure of how long it was going on.
 *
 * The last entry is not a stopped teardown — it is one that is about to try again.
 * It belongs here anyway, because `last_failure` is what the `retrying` shape below
 * measures its patience from, and a pattern list that cannot see the line would
 * make that shape unreachable and report the wait as an alarm.
 */
const FAILURE_PATTERNS = [
  "destroy failed%", // the unbounded loop, and the "(attempt N of 8)" cap
  "destroy cannot succeed%", // the cap's terminal case
  "Teardown failed%", // one attempt, returned an error
  "Teardown stopped%", // one attempt, killed mid-flight
  "Teardown attempt%", // a self-clearing failure, waiting for the next tick
];

const QUERY = `
  with failures as (
    select run_id,
           count(*)  as failures,
           min(ts)   as first_failure,
           max(ts)   as last_failure
      from run_logs
     where stream = 'stderr'
       and (${FAILURE_PATTERNS.map((_, i) => `message like $${i + 1}`).join(" or ")})
     group by run_id
  )
  select r.id,
         r.slug,
         r.status,
         r.clouds,
         r.mode,
         r.destroy_attempts,
         r.destroy_started_at,
         r.delete_requested,
         r.error,
         coalesce(f.failures, 0)          as failures,
         f.first_failure,
         f.last_failure,
         coalesce(r.expires_at, r.created_at) as eligible_since,
         (select max(ts) from run_logs l where l.run_id = r.id) as last_log,
         now() as now
    from workshop_runs r
    left join failures f on f.run_id = r.id
   where r.status in ('destroying', 'destroy_failed')
   order by coalesce(f.first_failure, r.expires_at, r.created_at)
`;

const hours = (from, to) => (to - from) / 3_600_000;

function ago(then, now) {
  if (!then) return "never";
  const h = hours(new Date(then), new Date(now));
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 48) return `${h.toFixed(1)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Which shape a row is.
 *
 * Five, and the three healthy ones are all transient: a run is waiting for its
 * attempt, running it, waiting out a self-clearing failure between ticks, flagged,
 * or the reaper has stopped touching it. That last one is the only alarm left, and
 * it is the *only* way a teardown can quietly cost money indefinitely — which is
 * why it gets two separate detections, one for each side of the claim.
 */
function classify(r) {
  const now = new Date(r.now);

  if (r.status === "destroy_failed") {
    return {
      level: "attention",
      kind: "flagged",
      why:
        `stopped after ${r.destroy_attempts} attempt(s) and is waiting for you. ` +
        "This is the policy working, not a fault — it is on the run page as " +
        '"Teardown failed" with the reason below. Deal with the cause, then ' +
        "press Retry teardown. Until then this run may still own billing resources.",
    };
  }

  // Claimed: an attempt owns this run. See `claimDestroy` — the claim is written
  // before any work starts and cleared on every way out.
  if (r.destroy_started_at) {
    const runningFor = hours(new Date(r.destroy_started_at), now) * 60;
    if (runningFor > ATTEMPT_MINUTES) {
      return {
        level: "alarm",
        kind: "claim never cleared",
        why:
          `an attempt claimed this run ${ago(r.destroy_started_at, now)} and has ` +
          `neither finished nor been flagged. It cannot still be running: the ` +
          `reaper job is capped at 1800s. A killed attempt is flagged by the next ` +
          `tick that reaches the run, so ${Math.round(runningFor)}m of silence ` +
          "means no tick has. Check the reaper job's executions, and whether an " +
          "advisory lock from a dead session is still held.",
      };
    }
    return {
      level: "ok",
      kind: "in progress",
      // `claimDestroy` stamps the claim and bumps the counter in one statement, so
      // these agree — except on a row that was mid-teardown when 0024 added the
      // column, where the claim is this attempt's and the counter is not.
      why: `attempt ${Math.max(r.destroy_attempts, 1)} started ${ago(r.destroy_started_at, now)}`,
    };
  }

  // Unclaimed, but this run has already run an attempt and failed recently: it is
  // between ticks on a self-clearing failure, which `setDestroyRetry` leaves in
  // exactly this state (see rule 3 in `destroy-policy.ts`). Recognised before the
  // silence check below, and measured from the failure rather than from
  // eligibility, because a slow AWS teardown can burn most of SILENT_HOURS before
  // the retry is even due — which would report a working policy as an alarm.
  if (
    r.destroy_attempts > 0 &&
    r.last_failure &&
    hours(new Date(r.last_failure), now) * 60 < RETRY_MINUTES
  ) {
    return {
      level: "ok",
      kind: "retrying",
      why:
        `attempt ${r.destroy_attempts} failed ${ago(r.last_failure, now)} on a ` +
        "condition that clears itself; the next tick picks it up",
    };
  }

  // Unclaimed and in `destroying`: due, and waiting for a tick to pick it up.
  const waitingFor = hours(new Date(r.eligible_since), now);
  if (waitingFor > SILENT_HOURS) {
    return {
      level: "alarm",
      kind: "never picked up",
      why:
        `eligible for teardown ${ago(r.eligible_since, now)} and no attempt has ` +
        "claimed it. The reaper ticks every five minutes, so either it is not " +
        "running, it is failing before it reaches this run, or an advisory lock " +
        "from a killed execution is still held. Nothing will flag this on its own.",
    };
  }

  return {
    level: "ok",
    kind: "queued",
    why: `due ${ago(r.eligible_since, now)}, waiting for the next tick`,
  };
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run via make stuck-teardowns).");
  process.exit(2);
}

// Exit 1 is reserved for "the report found something", so a database this could
// not read has to be a different code — otherwise a monitor cannot tell a wedged
// teardown from a monitor that is broken, and the second one hides the first.
// This is not hypothetical: it happens for real whenever the code is ahead of the
// schema, between a merge and the pipeline's migrate step.
let rows;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  ({ rows } = await client.query(QUERY, FAILURE_PATTERNS));
} catch (err) {
  console.error(`Could not read the database: ${err.message}`);
  console.error(
    "This report says nothing about the teardowns either way. If the column it " +
      "asked for does not exist, this checkout is ahead of the database's schema.",
  );
  process.exit(2);
} finally {
  await client.end().catch(() => {});
}

if (rows.length === 0) {
  console.log("No run is tearing down. Nothing to look at.");
  process.exit(0);
}

const ORDER = { alarm: 0, attention: 1, ok: 2 };
const MARK = { alarm: "!!", attention: " !", ok: "  " };

const seen = rows
  .map((r) => ({ r, c: classify(r) }))
  .sort((a, b) => ORDER[a.c.level] - ORDER[b.c.level]);

for (const { r, c } of seen) {
  console.log(
    `\n${MARK[c.level]} ${r.slug}  [${c.kind}]  ${r.status}` +
      `  ${r.mode}/${(r.clouds ?? []).join("+") || "no cloud"}`,
  );
  console.log(`     ${c.why}`);
  console.log(
    `     attempts: ${r.destroy_attempts} recorded, ${r.failures} failure(s) in the log` +
      (r.failures > r.destroy_attempts
        ? "  <- log outruns the counter, so some of this predates the one-attempt policy"
        : ""),
  );
  console.log(
    `     first failure ${ago(r.first_failure, r.now)}` +
      `, last ${ago(r.last_failure, r.now)}` +
      `, last log line ${ago(r.last_log, r.now)}`,
  );
  console.log(`     delete requested: ${r.delete_requested}`);
  console.log(`     run: /runs/${r.id}`);
  if (r.error) {
    console.log(`     error: ${r.error.split("\n")[0]}`);
  }
}

const alarms = seen.filter((s) => s.c.level === "alarm").length;
const attention = seen.filter((s) => s.c.level === "attention").length;
const ok = seen.filter((s) => s.c.level === "ok").length;

console.log(
  `\n${seen.length} tearing down: ${alarms} not being touched, ` +
    `${attention} flagged for you, ${ok} healthy`,
);
if (alarms || attention) process.exit(1);

// Report every teardown that is not finishing, and say which kind of not
// finishing it is.
//
// The teardown loop that ran 572 times went unnoticed for a month because
// "retrying forever" and "making progress" were the same row: status
// `destroying`, no counter, no timestamp, nothing on any page. `destroy-policy.ts`
// fixed the loop, but a bounded retry is still only visible to somebody who
// looks — so this is the looking, in one command:
//
//   make stuck-teardowns          # against Cloud SQL, through the proxy
//   node frontend/scripts/stuck-teardowns.mjs   # with DATABASE_URL already set
//
// Exits 1 when something needs a person, so it can be wired to a cron or a
// pipeline step later without changing anything here.
//
// Read-only. Every query is a select; nothing here changes a run's state, on
// purpose — deciding what to do about a wedged teardown needs the reason, and
// this tool's whole job is to hand over the reason.
import pg from "pg";

/**
 * How long a run may sit in `destroying` with nothing recorded before it counts
 * as suspicious.
 *
 * The reaper ticks every five minutes and its Cloud Run job is capped at 1800s,
 * so a single attempt cannot legitimately run longer than 30 minutes: past that
 * the container is killed. An hour is therefore two full attempts' worth of
 * grace, and a run still showing zero recorded attempts after it has not merely
 * been slow — nothing is reaching the code that records anything.
 */
const SILENT_HOURS = Number(process.env.SILENT_HOURS ?? 1);

/**
 * How overdue a backed-off run may be before the backoff stops being the
 * explanation. Past this, the run is due and is not being picked up, which is a
 * statement about the reaper rather than about the run.
 */
const OVERDUE_HOURS = Number(process.env.OVERDUE_HOURS ?? 1);

/**
 * Log lines a failed destroy attempt writes, old and new.
 *
 * The pre-fix reaper wrote "destroy failed, will retry: …" on every tick, so
 * these patterns are what makes the history legible: a run whose stored counter
 * says 2 and whose log holds 500 of these has been through the old loop, and the
 * count is the honest measure of how long this has been going on.
 */
const FAILURE_PATTERNS = [
  "destroy failed%", // both the old line and the new "(attempt N of 8)" one
  "destroy cannot succeed%", // terminal, gave up on attempt 1
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
         r.destroy_next_attempt_at,
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

function ahead(then, now) {
  const h = hours(new Date(now), new Date(then));
  if (h < 0) return `${ago(then, now)} (overdue)`;
  if (h < 1) return `in ${Math.round(h * 60)}m`;
  return `in ${h.toFixed(1)}h`;
}

/**
 * Which of the four shapes a row is. Only `backing-off` is a healthy answer; the
 * others each want a different response, which is why they are named separately
 * rather than collapsed into "stuck".
 */
function classify(r) {
  const now = new Date(r.now);
  const silentFor = hours(new Date(r.eligible_since), now);

  if (r.status === "destroy_failed") {
    return {
      level: "attention",
      kind: "gave up",
      why:
        `stopped after ${r.destroy_attempts} attempt(s) and is waiting for you. ` +
        "This is the fix working — it is on the run page as \"Teardown failed\" " +
        "with the reason below. Fix the cause and press Retry teardown.",
    };
  }

  if (r.destroy_attempts === 0 && silentFor > SILENT_HOURS) {
    return {
      level: "alarm",
      kind: "retrying without recording",
      why:
        `eligible for teardown ${ago(r.eligible_since, now)} and still at zero ` +
        "recorded attempts. The retry budget only advances from the reaper's " +
        "catch block, so a destroy that never returns — a tofu destroy running " +
        "past the job's 1800s timeout, an OOM, a killed container — is retried " +
        "on the next tick with the counter untouched. That is the old infinite " +
        "loop, and it is the one shape the attempt cap cannot see. Check the " +
        "reaper job's executions for a timeout or a non-zero exit.",
    };
  }

  if (r.destroy_next_attempt_at) {
    const overdueBy = hours(new Date(r.destroy_next_attempt_at), now);
    if (overdueBy > OVERDUE_HOURS) {
      return {
        level: "alarm",
        kind: "due but not picked up",
        why:
          `next attempt was due ${ago(r.destroy_next_attempt_at, now)} and has ` +
          "not happened. The backoff is not the explanation any more — either " +
          "the reaper is not running, it is failing before it reaches this run, " +
          "or an advisory lock from a killed execution is still held.",
      };
    }
    return {
      level: "ok",
      kind: "backing off",
      why: `attempt ${r.destroy_attempts + 1} due ${ahead(r.destroy_next_attempt_at, r.now)}`,
    };
  }

  return {
    level: "ok",
    kind: "in progress",
    why: `attempt ${r.destroy_attempts + 1} is due now or running`,
  };
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run via make stuck-teardowns).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(QUERY, FAILURE_PATTERNS);
await client.end();

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
      (r.failures > r.destroy_attempts + 1
        ? "  <- log outruns the counter, so some of this predates the cap"
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
  `\n${seen.length} tearing down: ${alarms} looping, ${attention} gave up, ${ok} healthy`,
);
if (alarms || attention) process.exit(1);

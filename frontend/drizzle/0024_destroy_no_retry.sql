-- Stop retrying a failed teardown at all: flag it and wait for a person.
--
-- 0023 replaced an unbounded retry with an eight-attempt budget and exponential
-- backoff. The budget worked — both wedged runs stopped — but it kept the premise
-- that a failed teardown is worth repeating, and production says otherwise:
-- `zone-b-dfae0a` logged 9,482 failed attempts over 33 days and `aws-platform`
-- 640 over three, every one doomed for the same reason as the first. Each attempt
-- is a Cloud Run execution plus a full init/destroy against live cloud APIs, and
-- cost control is the whole point of the reaper.
--
-- So one attempt, then `destroy_failed` with the reason on the row.
--
--   destroy_started_at      set when an attempt claims the teardown, cleared on
--                           every way out of it. A claim still set while the
--                           reaper holds the run's advisory lock proves the
--                           claimant was killed — the one failure the attempt
--                           counter could never see, because nothing incremented
--                           it. That is flagged too, not retried.
--
--   destroy_next_attempt_at dropped. Nothing schedules a next attempt any more,
--                           and a column that says otherwise is a lie about the
--                           policy. Its only values were transient scheduling
--                           timestamps, so nothing is lost with it.
--
-- `destroy_attempts` stays and keeps counting, but its meaning changes from "the
-- budget spent so far" to "how many times this teardown has been tried in total",
-- including a person's retries. Not reset on success, so a run that took three
-- goes still says so.
--
-- No backfill of in-flight runs, deliberately: a run mid-teardown gets a null
-- claim, which reads as "not claimed" and lets it have its one clean attempt.
-- Guessing that a currently-running destroy is dead would flag a healthy run.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-feature      — the column is added and the old one dropped
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.workshop_runs') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table workshop_runs
    add column if not exists destroy_started_at timestamptz;

  -- The index goes with the column it covered. Dropped first so the column drop
  -- does not have to cascade, which keeps this readable in the schema history.
  drop index if exists workshop_runs_destroy_due_idx;

  alter table workshop_runs
    drop column if exists destroy_next_attempt_at;
end $$;

commit;

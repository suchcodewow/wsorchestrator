-- Bound the teardown retry loop.
--
-- The reaper caught every destroy failure and left the run in `destroying` for
-- the next tick, with no cap and no backoff. On a five-minute cron that is 288
-- attempts a day, forever: run `aws-platform` logged 572 identical ones over two
-- days against a destroy that could not succeed on any of them, and
-- `zone-b-dfae0a` sat in `destroying` from 2026-08-06. Neither showed up as a
-- problem anywhere, because "still retrying" and "making progress" looked the
-- same from outside.
--
-- Three columns and one status:
--
--   destroy_attempts        consecutive failed teardown attempts.
--   destroy_next_attempt_at earliest time the next attempt may start; the
--                           reaper skips the run until then. Null means now.
--   destroy_failed          terminal. The reaper stops; a person retries it
--                           from the run page, which resets the two columns.
--
-- `destroy_failed` is added BEFORE `destroyed` for readability in \dT and
-- nothing more — no code compares run statuses by position (unlike `site_role`,
-- see 0015), so the placement carries no meaning.
--
-- Backfill, deliberate: the two runs currently wedged in `destroying` are left in
-- `destroying` with a zero counter rather than being moved to `destroy_failed`.
-- They get the new budget applied from here, so they retry a few times with
-- backoff and then land in `destroy_failed` on their own, with the real error
-- recorded on the row. Declaring them failed here would be guessing at a reason;
-- letting the new code reach that conclusion records the actual one.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-feature      — the enum value and both columns are added
--   * already migrated — every step is a guarded no-op

begin;

-- Outside the DO block: ALTER TYPE ... ADD VALUE may not be executed from
-- inside a plpgsql body. Transactional on PG 12+ so long as the new value is
-- not *used* in the same transaction, and nothing here uses it.
alter type run_status add value if not exists 'destroy_failed' before 'destroyed';

do $$
begin
  if to_regclass('public.workshop_runs') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table workshop_runs
    add column if not exists destroy_attempts integer not null default 0;

  alter table workshop_runs
    add column if not exists destroy_next_attempt_at timestamptz;

  -- The reaper's query filters on this every tick, and a run that is not due is
  -- the common case once anything is backing off.
  create index if not exists workshop_runs_destroy_due_idx
    on workshop_runs (destroy_next_attempt_at);
end $$;

commit;

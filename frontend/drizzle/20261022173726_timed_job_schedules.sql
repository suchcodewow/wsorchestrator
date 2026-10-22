-- timed_jobs.cron, time_zone and scheduled_for: the app's own timed jobs are
-- now started by its dispatcher, which Cloud Scheduler calls every five
-- minutes, rather than by a Cloud Scheduler job each. A job's schedule is set
-- on Admin Settings → Timed Jobs (null keeps the default in
-- lib/timed-jobs-registry.ts), and scheduled_for is the latest time the
-- dispatcher started it for, so no time is run twice.
--
-- Safe to run on any database:
--   * no table yet — skipped
--   * before this — the columns are added
--   * already migrated — left alone

begin;

do $$
begin
  if to_regclass('public.timed_jobs') is null then
    raise notice 'no timed_jobs yet — nothing to migrate';
    return;
  end if;

  alter table timed_jobs add column if not exists cron text;
  alter table timed_jobs add column if not exists time_zone text;
  alter table timed_jobs add column if not exists scheduled_for timestamptz;
end
$$;

commit;

-- The cohort Slack sync also sends the intake form's reminders: a run says
-- what it set out to do (scope), how many direct messages it sent (messaged),
-- and why any part of it did nothing (notes). Every run before this synced
-- channels only. The last-run setting the reminders kept on their own goes,
-- since their runs are now in the sync's log.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the columns and check added, the setting removed
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.slack_sync_runs') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table slack_sync_runs add column if not exists scope text not null default 'channels';
  alter table slack_sync_runs add column if not exists messaged integer not null default 0;
  alter table slack_sync_runs add column if not exists notes jsonb not null default '[]'::jsonb;
  alter table slack_sync_runs drop constraint if exists slack_sync_runs_scope_check;
  alter table slack_sync_runs
    add constraint slack_sync_runs_scope_check check (scope in ('all', 'channels', 'reminders'));

  delete from evals_settings where key = 'intake_reminders_last_run';
end $$;

commit;

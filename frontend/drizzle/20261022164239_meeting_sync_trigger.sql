-- meeting_sync_runs.trigger: whether a run of the Google Meetings sync came
-- from the daily schedule or from Sync Now, as the HiBob and Slack logs already
-- say. Every run before this was a Sync Now, so the default is 'manual'.
--
-- Safe to run on any database:
--   * no table yet — skipped
--   * before this — the column and its check are added
--   * already migrated — left alone

begin;

do $$
begin
  if to_regclass('public.meeting_sync_runs') is null then
    raise notice 'no meeting_sync_runs yet — nothing to migrate';
    return;
  end if;

  alter table meeting_sync_runs add column if not exists trigger text not null default 'manual';

  if not exists (select 1 from pg_constraint where conname = 'meeting_sync_runs_trigger_check') then
    alter table meeting_sync_runs add constraint meeting_sync_runs_trigger_check check (trigger in ('schedule', 'manual'));
  end if;
end
$$;

commit;

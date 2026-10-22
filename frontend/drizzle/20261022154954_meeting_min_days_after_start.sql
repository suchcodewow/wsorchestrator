-- meeting_selections.min_days_after_start: days after a person's start date
-- before a picked meeting suits them. The sync invites each person to the first
-- occurrence on or after their start date plus this, or to the last one before
-- the bootcamp when none is. 0 by default, which asks nothing more.
--
-- Safe to run on any database:
--   * no table yet — skipped
--   * before this — the column and its check are added
--   * already migrated — left alone

begin;

do $$
begin
  if to_regclass('public.meeting_selections') is null then
    raise notice 'no meeting_selections yet — nothing to migrate';
    return;
  end if;

  alter table meeting_selections add column if not exists min_days_after_start integer not null default 0;

  if not exists (select 1 from pg_constraint where conname = 'meeting_selections_min_days_check') then
    alter table meeting_selections add constraint meeting_selections_min_days_check check (min_days_after_start between 0 and 365);
  end if;
end
$$;

commit;

-- checklist_alarm: the time a checklist item is due, in minutes after
-- midnight, which puts a mark on the schedule at that time of its day.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — column and its check added
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.schedule_checklist_items') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table schedule_checklist_items add column if not exists alarm integer;
  if not exists (select 1 from pg_constraint where conname = 'schedule_checklist_items_alarm_check') then
    alter table schedule_checklist_items
      add constraint schedule_checklist_items_alarm_check check (alarm between 0 and 1439);
  end if;
end
$$;

commit;

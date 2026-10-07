-- AM and PM checklists: each track-day's checklist splits into what is to be
-- done before the morning and before the afternoon. Items already there are
-- the morning's.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the period column added, every item AM, and checked
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.schedule_checklist_items') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table schedule_checklist_items add column if not exists period text not null default 'am';
  alter table schedule_checklist_items drop constraint if exists schedule_checklist_items_period_check;
  alter table schedule_checklist_items
    add constraint schedule_checklist_items_period_check check (period in ('am', 'pm'));
end $$;

commit;

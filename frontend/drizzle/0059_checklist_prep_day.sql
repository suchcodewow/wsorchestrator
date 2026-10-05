-- The Prep Day checklist: day 0 of Bootcamp, for what is to be done before
-- the bootcamp starts. No other track has a day 0.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the day check widened to take Bootcamp's day 0
--   * already migrated — the check dropped and added again, the same

begin;

do $$
begin
  if to_regclass('public.schedule_checklist_items') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table schedule_checklist_items drop constraint if exists schedule_checklist_items_day_check;
  alter table schedule_checklist_items
    add constraint schedule_checklist_items_day_check check (day between 0 and 30 and (day > 0 or track = 'btc'));
end $$;

commit;

-- Day checklists for every track: the SE tracks keep their own instead of
-- sharing their class's. Items already on Bootcamp or Intermediate stay there.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the track check widened
--   * already migrated — the check dropped and added again, the same

begin;

do $$
begin
  if to_regclass('public.schedule_checklist_items') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table schedule_checklist_items drop constraint if exists schedule_checklist_items_track_check;
  alter table schedule_checklist_items
    add constraint schedule_checklist_items_track_check check (track in ('btc', 'int', 'btc_se', 'int_se'));
end $$;

commit;

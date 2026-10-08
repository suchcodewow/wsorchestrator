-- schedule_checklist_items.position: each item's place in its half-day, so a
-- card dragged up or down on the checklist board stays where it was put. Until
-- now items were shown oldest first, so each half is numbered that way the
-- first time, 0 upwards, and nothing on any board moves.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the column added, numbered, and indexed
--   * already migrated — every step is a guarded no-op; positions set by
--                        dragging are never renumbered

begin;

do $$
begin
  if to_regclass('public.schedule_checklist_items') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'schedule_checklist_items' and column_name = 'position'
  ) then
    alter table schedule_checklist_items add column position integer not null default 0;

    update schedule_checklist_items i
       set position = n.place
      from (
        select id,
               row_number() over (partition by bootcamp_id, track, day, period order by created_at, id) - 1 as place
          from schedule_checklist_items
      ) n
     where i.id = n.id;
  else
    raise notice 'schedule_checklist_items.position already exists — skipped';
  end if;

  create index if not exists schedule_checklist_items_place_idx
    on schedule_checklist_items (bootcamp_id, track, day, period, position);
end $$;

commit;

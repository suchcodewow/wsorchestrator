-- employees.track: the title list — sales, engineer or ignored — that a
-- person's title was on when the HiBob sync that stored them ran; null for a
-- title on no list and for anyone not under the Organization Leader. The
-- Cohorts page's Current tab lists everyone whose track is sales or engineer.
--
-- Backfilled from the title lists as they stand, for everyone the last sync
-- put under the leader, so the tab is not empty until the next sync. Titles
-- compare as the app compares them: whitespace collapsed, case ignored.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the column is added and backfilled as above
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table employees add column if not exists track text;

  -- Only into a database no new sync has written yet: once one has, its
  -- values are the ones the title lists gave at that sync.
  if not exists (select 1 from employees where track is not null) then
    update employees e
       set track = t.list
      from evals_titles t
     where e.org_depth is not null
       and lower(btrim(regexp_replace(e.title, '\s+', ' ', 'g'))) = lower(t.title);
  end if;
end $$;

commit;

-- A breakout names the eVals assessment its instructors score their groups
-- on, so an assessment's "Assigned to me" is the groups of the breakouts that
-- name it rather than of every breakout in its stage.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the column added, empty
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.schedule_sessions') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table schedule_sessions
    add column if not exists assessment_id uuid references evals_assessments (id) on delete set null;
end $$;

commit;

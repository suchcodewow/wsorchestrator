-- Which deployment created a run, so another deployment holding a copy of the
-- row leaves it alone.
--
-- QA can import a production backup. Those rows name production's live
-- Workspace users, Harness orgs and cloud accounts, which QA's reaper could
-- otherwise tear down, because the accounts are shared. The import stamps
-- every row it brings over `production`, and the runner and app act only on
-- rows that are null or carry their own environment.
--
-- Null is left alone: every existing row belongs to the database it is in.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped; db:push creates the schema outright
--   * already migrated — `if not exists` makes it a no-op

begin;

do $$
begin
  if to_regclass('public.workshop_runs') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table workshop_runs add column if not exists environment text;
end $$;

commit;

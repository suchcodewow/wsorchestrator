-- Drops evals_organization_members, whose rows 0040 copied onto
-- employees.org_depth and hibob_sync_runs.org_leader_email.
--
-- This runs before the new image goes live, so until it does, the revision
-- still serving fails on the Organization tab and on a HiBob sync. It shipped
-- in the same release as 0040 regardless, at a time nobody was using the app.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table is dropped
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  drop table if exists evals_organization_members;
end $$;

commit;

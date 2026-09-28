-- The eVals area: a third functional area, with the same roles as the
-- scheduler — `viewer | administrator`, null meaning no access — on both users
-- and invite links.
--
-- No backfill: nobody gains eVals access. Platform administrators have it
-- already, since the app treats them as an administrator in every area.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before eVals     — the type and both columns are added
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  -- `create type` has no `if not exists`, so the guard is explicit.
  if not exists (select 1 from pg_type where typname = 'evals_role') then
    create type evals_role as enum ('viewer', 'administrator');
  else
    raise notice 'evals_role type already exists — skipped';
  end if;

  alter table users add column if not exists evals_role evals_role;

  if to_regclass('public.user_invites') is not null then
    alter table user_invites add column if not exists evals_role evals_role;
  end if;
end $$;

commit;

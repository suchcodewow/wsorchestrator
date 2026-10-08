-- Iris is part of the assessments area now, not an area of its own: an
-- Assessments Viewer takes the placement tests, an Assessments Administrator
-- runs them. Everyone keeps the higher of their two roles — an Iris Taker is
-- an Assessments Viewer at least, an Iris Administrator an Assessments
-- Administrator — and the Iris role is then cleared, on people and on open
-- invite links alike. Clearing it is what makes this safe to run on every
-- deploy: a role an administrator later lowers is never raised again.
--
-- The iris_role columns stay, unread, so an older build still starts against
-- this database after a rollback (it would see no one with an Iris role).
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — every Iris role moved, then cleared
--   * already migrated — nobody has an Iris role, so nothing changes

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  update users
     set evals_role = case
           when iris_role = 'administrator' or evals_role = 'administrator' then 'administrator'::evals_role
           else 'viewer'::evals_role
         end,
         iris_role = null
   where iris_role is not null;

  if to_regclass('public.user_invites') is not null then
    update user_invites
       set evals_role = case
             when iris_role = 'administrator' or evals_role = 'administrator' then 'administrator'::evals_role
             else 'viewer'::evals_role
           end,
           iris_role = null
     where iris_role is not null;
  end if;
end $$;

commit;

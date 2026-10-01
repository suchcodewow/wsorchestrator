-- The scheduler area's role system is renamed to "training": the role system
-- only, not the existing /scheduler and /scheduler-settings nav items or
-- pages, which keep their text and routes.
--
--   * enum type `scheduler_role` -> `training_role`
--   * `users.scheduler_role` -> `users.training_role`
--   * `user_invites.scheduler_role` -> `user_invites.training_role`
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-rename        — the type and both columns are renamed
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  if exists (select 1 from pg_type where typname = 'scheduler_role') then
    alter type scheduler_role rename to training_role;
  elsif not exists (select 1 from pg_type where typname = 'training_role') then
    raise notice 'neither scheduler_role nor training_role exists — nothing to rename';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'users' and column_name = 'scheduler_role'
  ) then
    alter table users rename column scheduler_role to training_role;
  end if;

  if to_regclass('public.user_invites') is not null and exists (
    select 1 from information_schema.columns
    where table_name = 'user_invites' and column_name = 'scheduler_role'
  ) then
    alter table user_invites rename column scheduler_role to training_role;
  end if;
end $$;

commit;

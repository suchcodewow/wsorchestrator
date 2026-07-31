-- Site roles, the calendar scope that comes with them, and the delete flag.
--
-- Three additions, one migration, because they arrived as one feature:
--   * users.site_role       — operator | manager | administrator
--   * users.calendar_scope  — own | all (a manager's "show everyone's events")
--   * workshop_runs.delete_requested — a delete that is waiting on teardown
--
-- Same shape as 0002/0003: `drizzle-kit push` can create the enums and columns
-- itself but prompts before adding a NOT NULL column to a populated table. The
-- explicit defaults mean every existing account lands on `operator` with its
-- own calendar — the only behaviour there has ever been — and every existing
-- run on "no delete pending", so nothing changes for anyone as a result of
-- this migration.
--
-- The first administrator does not come from here: roles are granted by an
-- administrator, so a database where everyone is an operator needs one from
-- outside the app. That is SITE_ADMIN_EMAILS, applied at sign-in (see
-- frontend/src/auth.ts).
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-roles        — types and columns added, existing rows take defaults
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  -- Nothing to alter on a brand-new database: `db:push` will create the
  -- current schema, enums included, directly.
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  -- `create type` has no `if not exists`, so the guards are explicit.
  if not exists (select 1 from pg_type where typname = 'site_role') then
    create type site_role as enum ('operator', 'manager', 'administrator');
  else
    raise notice 'site_role type already exists — skipped';
  end if;

  if not exists (select 1 from pg_type where typname = 'calendar_scope') then
    create type calendar_scope as enum ('own', 'all');
  else
    raise notice 'calendar_scope type already exists — skipped';
  end if;

  alter table users
    add column if not exists site_role site_role not null default 'operator',
    add column if not exists calendar_scope calendar_scope
      not null default 'own';

  if to_regclass('public.workshop_runs') is not null then
    alter table workshop_runs
      add column if not exists delete_requested boolean not null default false;
  end if;
end $$;

commit;

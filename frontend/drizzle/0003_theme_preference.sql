-- Add the per-user colour scheme preference to the users table.
--
-- Same shape as 0002: `drizzle-kit push` can create the enum and column, but
-- prompts before adding a NOT NULL column to a populated table. The explicit
-- default means every existing account lands on 'system', which is also what
-- new accounts get, so nobody's UI changes as a result of this migration.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-theme        — type and column added, existing rows default to system
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  -- Nothing to alter on a brand-new database: `db:push` will create the
  -- current schema, enum included, directly.
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  -- `create type` has no `if not exists`, so the guard is explicit.
  if not exists (select 1 from pg_type where typname = 'theme_preference') then
    create type theme_preference as enum ('light', 'dark', 'system');
  else
    raise notice 'theme_preference type already exists — skipped';
  end if;

  alter table users
    add column if not exists theme_preference theme_preference
      not null default 'system';
end $$;

commit;

-- users.favorite_tabs: the tabs a user has starred, [{ href, label }] in the
-- order they were starred. The sidebar lists them under "Favorites".
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — column added
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table users
    add column if not exists favorite_tabs jsonb not null default '[]'::jsonb;
end $$;

commit;

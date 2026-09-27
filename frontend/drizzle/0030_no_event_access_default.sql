-- New sign-ins start with no event access.
--
-- Split from 0029 because that file adds the `none` value, and Postgres
-- refuses to use an enum value in the transaction that added it. Only the
-- default changes: every existing user keeps the event role they have.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped; db:push creates the schema outright
--   * already migrated — setting the same default again is a no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table users alter column site_role set default 'none';
end $$;

commit;

-- users.is_test_account: an account a platform administrator made to test the
-- app as, outside production. A platform administrator viewing the app as one
-- may change things in its name (src/lib/test-accounts.ts). False for every
-- existing account, so nothing anyone could do before changes.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the column added
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table users add column if not exists is_test_account boolean not null default false;
end $$;

commit;

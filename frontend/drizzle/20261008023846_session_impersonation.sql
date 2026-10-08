-- sessions.impersonating_email: the employee a platform administrator is
-- viewing the app as in that browser session. Null for every existing
-- session, so nobody is impersonating anyone after this runs.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the column added
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.sessions') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table sessions add column if not exists impersonating_email text;
end $$;

commit;

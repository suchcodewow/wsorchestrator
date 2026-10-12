-- What the cohort test group has made outside the app (Slack channels and
-- calendar invites), so turning the test group off can archive and cancel them.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists test_group_artifacts (
    kind text not null,
    key text not null,
    ref text,
    created_at timestamptz not null default now(),
    primary key (kind, key)
  );
end $$;

commit;

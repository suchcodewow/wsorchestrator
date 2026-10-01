-- `evals_settings`: one row per eVals-wide setting, such as the Organization
-- Leader (the person whose reports eVals draws attendees from). Keyed by
-- name rather than a fixed id so a new setting needs no migration beyond an
-- insert.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-feature      — the table and its index are created
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'no users table — nothing to attach evals_settings to';
    return;
  end if;

  create table if not exists evals_settings (
    key text primary key,
    value text not null,
    updated_by text references users(id) on delete set null,
    updated_at timestamptz not null default now()
  );
end $$;

commit;

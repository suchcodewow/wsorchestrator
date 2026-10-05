-- Canary Wire: the newest Mindtickle pull, and the exemptions set by hand
-- that override bootcamp history for one person.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — both tables created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.bootcamp_history') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists canary_wire_snapshots (
    id uuid primary key default gen_random_uuid(),
    fetched_at timestamptz not null,
    learners integer not null,
    data jsonb not null,
    saved_by text constraint canary_wire_snapshots_saved_by_users_id_fk references users (id) on delete set null,
    saved_at timestamptz not null default now()
  );

  create table if not exists canary_wire_exemptions (
    email text primary key,
    accountable_from text,
    updated_by text constraint canary_wire_exemptions_updated_by_users_id_fk references users (id) on delete set null,
    updated_at timestamptz not null default now()
  );
end $$;

commit;

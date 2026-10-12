-- Whether each scheduled job is switched on, and how its last run went, for
-- the Timed Jobs tab under Settings. One row per job, made the first time the
-- job runs or is switched; no row means on and never run.
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

  create table if not exists timed_jobs (
    key text primary key,
    enabled boolean not null default true,
    last_started_at timestamptz,
    last_finished_at timestamptz,
    last_status text,
    last_detail text,
    updated_by text
      constraint timed_jobs_updated_by_users_id_fk references users (id) on delete set null,
    updated_at timestamptz not null default now()
  );
end $$;

commit;

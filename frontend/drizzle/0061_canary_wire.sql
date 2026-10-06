-- Canary Wire: the newest Mindtickle pull, and the pulls in progress.
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

  create table if not exists canary_wire_pulls (
    id uuid primary key default gen_random_uuid(),
    trigger text not null,
    started_by text constraint canary_wire_pulls_started_by_users_id_fk references users (id) on delete set null,
    status text not null default 'running',
    message text not null default '',
    done integer not null default 0,
    total integer not null default 0,
    state jsonb,
    leased_until timestamptz,
    error text,
    started_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    finished_at timestamptz,
    constraint canary_wire_pulls_trigger_check check (trigger in ('manual', 'schedule')),
    constraint canary_wire_pulls_status_check check (status in ('running', 'succeeded', 'failed'))
  );
  create index if not exists canary_wire_pulls_started_at_idx on canary_wire_pulls (started_at);
  create unique index if not exists canary_wire_pulls_one_running_idx
    on canary_wire_pulls (status) where status = 'running';
end $$;

commit;

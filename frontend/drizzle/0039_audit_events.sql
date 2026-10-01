-- The audit trail: one row per action anyone or anything took — every change
-- through the API, sign-ins and sign-outs, saved preferences, and what the
-- runner did to a workshop. Rows are only ever inserted. Deleting a user keeps
-- their rows (actor_id goes null; the copied name and email stay).
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before the trail — the enums, table and indexes are created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  if not exists (select 1 from pg_type where typname = 'audit_via') then
    create type audit_via as enum ('session', 'token', 'system', 'anonymous');
  end if;
  if not exists (select 1 from pg_type where typname = 'audit_outcome') then
    create type audit_outcome as enum ('succeeded', 'denied', 'failed');
  end if;

  create table if not exists audit_events (
    id uuid primary key default gen_random_uuid(),
    at timestamptz not null default now(),
    actor_id text references users(id) on delete set null,
    actor_name text,
    actor_email text,
    via audit_via not null,
    action text not null,
    summary text not null,
    path text,
    target text,
    target_label text,
    status integer,
    outcome audit_outcome not null,
    detail jsonb,
    ip text
  );

  create index if not exists audit_events_at_idx on audit_events (at);
  create index if not exists audit_events_actor_idx on audit_events (actor_id, at);
  create index if not exists audit_events_action_idx on audit_events (action, at);
end $$;

commit;

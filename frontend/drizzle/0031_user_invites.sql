-- Invite links: a role grant anyone who follows the link and signs in picks
-- up, if they have no access yet. Only the token's hash is stored.
--
-- A null role means that area is not granted. Deleting the administrator who
-- made an invite deletes the invite with them.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before invites   — the table and its index are created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists user_invites (
    id uuid primary key default gen_random_uuid(),
    token_hash text not null unique,
    event_role site_role,
    scheduler_role scheduler_role,
    created_by text not null references users(id) on delete cascade,
    expires_at timestamptz not null,
    uses integer not null default 0,
    created_at timestamptz not null default now()
  );

  create index if not exists user_invites_created_by_idx
    on user_invites (created_by, created_at);
end $$;

commit;

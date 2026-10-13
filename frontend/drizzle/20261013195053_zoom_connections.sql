-- zoom_connections: the Zoom user Google Meetings schedules its Zoom meetings
-- as, one row keyed 'meetings'. It replaces the Server-to-Server OAuth app
-- (ZOOM_ACCOUNT_ID), whose admin scopes reached every meeting on the Zoom
-- account: a user-managed app, authorized by one user, reaches only that
-- user's meetings. The refresh token (rotated by Zoom on every use) and the
-- access token are sealed by lib/secret-box.ts.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists zoom_connections (
    key text primary key,
    email text not null,
    refresh_token bytea not null,
    access_token bytea,
    access_token_expires_at timestamptz,
    scope text not null,
    connected_by text references users (id) on delete set null,
    connected_at timestamptz not null default now()
  );
end $$;

commit;

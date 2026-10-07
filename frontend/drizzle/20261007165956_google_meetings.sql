-- google_meetings: the meetings eVals Settings → Google Meetings lists. Sync
-- Now creates or updates each one's Google Calendar invite and Zoom meeting,
-- and records here what it made and whom it invited.
--
-- google_connections: the Google account those invites are sent from, one row
-- keyed 'meetings', with its refresh token sealed by lib/secret-box.ts.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — both tables created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists google_meetings (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    starts_at timestamptz not null,
    duration_minutes integer not null,
    groups text[] not null default '{}',
    google_event_id text,
    zoom_meeting_id text,
    zoom_join_url text,
    invited_emails text[] not null default '{}',
    changed_at timestamptz not null default now(),
    synced_at timestamptz,
    sync_error text,
    created_by text references users (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint google_meetings_duration_check check (duration_minutes in (15, 30, 60))
  );

  create index if not exists google_meetings_starts_at_idx on google_meetings (starts_at, id);

  create table if not exists google_connections (
    key text primary key,
    email text not null,
    refresh_token bytea not null,
    scope text not null,
    calendar_id text,
    shared_with text[] not null default '{}',
    connected_by text references users (id) on delete set null,
    connected_at timestamptz not null default now(),
    sync_started_at timestamptz,
    last_sync_at timestamptz,
    last_sync_error text
  );
end $$;

commit;

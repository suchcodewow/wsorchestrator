-- Async recordings: the link anyone opens to record their camera, and their
-- screen if they want, with no account; and each stream they upload. The
-- video itself is kept outside the database, by src/lib/recording/storage.ts.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the tables created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists recording_links (
    id uuid primary key default gen_random_uuid(),
    created_by text
      constraint recording_links_created_by_users_id_fk references users (id) on delete set null,
    created_at timestamptz not null default now(),
    retired_at timestamptz
  );

  create table if not exists recording_tracks (
    id uuid primary key default gen_random_uuid(),
    link_id uuid not null
      constraint recording_tracks_link_id_recording_links_id_fk references recording_links (id),
    take_id uuid not null,
    kind text not null,
    mime_type text not null,
    started_at timestamptz not null,
    offset_ms integer not null default 0,
    contributor text not null default '',
    status text not null default 'uploading',
    chunks integer,
    duration_ms integer,
    file_bytes bigint,
    error text,
    last_chunk_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint recording_tracks_kind_check check (kind in ('camera', 'screen')),
    constraint recording_tracks_status_check check (status in ('uploading', 'assembling', 'ready', 'failed'))
  );
  create unique index if not exists recording_tracks_take_kind_idx on recording_tracks (take_id, kind);
  create index if not exists recording_tracks_started_at_idx on recording_tracks (started_at);
end $$;

commit;

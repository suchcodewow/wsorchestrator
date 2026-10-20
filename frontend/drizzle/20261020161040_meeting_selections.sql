-- meeting_selections: the Revenue Enablement calendar meetings Google Meetings
-- invites the cohort to, picked by name. meeting_occurrences: each event of a
-- picked name. meeting_invites: whom the sync put on each, how they answered,
-- and whether Zoom saw them join. meeting_attendance_marks: an administrator's
-- word on attendance, over Zoom's. meeting_sync_runs and meeting_sync_changes:
-- the sync's log, as slack_sync_runs and slack_sync_changes are Slack's.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — tables and indexes created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists meeting_selections (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    stage text not null,
    track text not null,
    synced_at timestamptz,
    created_by text
      constraint meeting_selections_created_by_users_id_fk references users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint meeting_selections_stage_check check (stage in ('bootcamp', 'intermediate', 'both')),
    constraint meeting_selections_track_check check (track in ('sales', 'engineer', 'both'))
  );

  create unique index if not exists meeting_selections_name_idx on meeting_selections (lower(name));

  create table if not exists meeting_occurrences (
    id uuid primary key default gen_random_uuid(),
    meeting_id uuid not null
      constraint meeting_occurrences_meeting_id_meeting_selections_id_fk references meeting_selections (id) on delete cascade,
    event_id text not null,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    start_date date not null,
    zoom_meeting_id text,
    attendance_read_at timestamptz
  );

  create unique index if not exists meeting_occurrences_event_idx on meeting_occurrences (meeting_id, event_id);
  create index if not exists meeting_occurrences_starts_at_idx on meeting_occurrences (meeting_id, starts_at);

  create table if not exists meeting_invites (
    occurrence_id uuid not null
      constraint meeting_invites_occurrence_id_meeting_occurrences_id_fk references meeting_occurrences (id) on delete cascade,
    email text not null,
    role text not null,
    added_by_sync boolean not null default true,
    test boolean not null default false,
    response_status text,
    attendance text,
    invited_at timestamptz not null default now(),
    constraint meeting_invites_occurrence_id_email_pk primary key (occurrence_id, email),
    constraint meeting_invites_role_check check (role in ('member', 'administrator')),
    constraint meeting_invites_attendance_check check (attendance in ('attended', 'missed'))
  );

  create index if not exists meeting_invites_email_idx on meeting_invites (email);

  create table if not exists meeting_attendance_marks (
    meeting_id uuid not null
      constraint meeting_attendance_marks_meeting_id_meeting_selections_id_fk references meeting_selections (id) on delete cascade,
    email text not null,
    attended boolean not null,
    marked_by text
      constraint meeting_attendance_marks_marked_by_users_id_fk references users (id) on delete set null,
    marked_at timestamptz not null default now(),
    constraint meeting_attendance_marks_meeting_id_email_pk primary key (meeting_id, email)
  );

  create index if not exists meeting_attendance_marks_email_idx on meeting_attendance_marks (email);

  create table if not exists meeting_sync_runs (
    id uuid primary key default gen_random_uuid(),
    triggered_by text
      constraint meeting_sync_runs_triggered_by_users_id_fk references users (id) on delete set null,
    status text not null default 'running',
    dry_run boolean not null,
    test_group boolean not null default false,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    invited integer not null default 0,
    removed integer not null default 0,
    attended integer not null default 0,
    missed integer not null default 0,
    none_left integer not null default 0,
    failures integer not null default 0,
    unfinished boolean not null default false,
    error text,
    notes jsonb not null default '[]'::jsonb,
    constraint meeting_sync_runs_status_check check (status in ('running', 'succeeded', 'skipped', 'failed'))
  );

  create index if not exists meeting_sync_runs_started_at_idx on meeting_sync_runs (started_at);
  create unique index if not exists meeting_sync_runs_one_running_idx
    on meeting_sync_runs (status) where status = 'running';

  create table if not exists meeting_sync_changes (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null
      constraint meeting_sync_changes_run_id_meeting_sync_runs_id_fk references meeting_sync_runs (id) on delete cascade,
    meeting_name text not null,
    occurrence_starts_at timestamptz,
    action text not null,
    email text not null default '',
    detail text,
    at timestamptz not null default now()
  );

  create index if not exists meeting_sync_changes_run_idx on meeting_sync_changes (run_id, at);
end $$;

commit;

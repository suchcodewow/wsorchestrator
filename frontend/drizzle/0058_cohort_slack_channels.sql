-- Cohort Slack channels: the contacts added to the active bootcamp's channels
-- beyond its cohort, each email's Slack user, each channel's id, who the sync
-- invited (and so may remove), and the sync's log.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the tables created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.bootcamps') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists cohort_channel_contacts (
    id uuid primary key default gen_random_uuid(),
    kind text not null,
    email text not null,
    full_name text not null default '',
    created_by text references users (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint cohort_channel_contacts_kind_check check (kind in ('sales', 'se'))
  );
  create unique index if not exists cohort_channel_contacts_kind_email_idx
    on cohort_channel_contacts (kind, email);

  create table if not exists slack_users (
    email text primary key,
    slack_user_id text,
    looked_up_at timestamptz not null default now()
  );

  create table if not exists slack_channels (
    name text primary key,
    slack_channel_id text not null,
    created boolean not null default false,
    created_at timestamptz not null default now()
  );

  create table if not exists slack_channel_members (
    slack_channel_id text not null,
    slack_user_id text not null,
    email text not null,
    added_at timestamptz not null default now(),
    primary key (slack_channel_id, slack_user_id)
  );

  create table if not exists slack_sync_runs (
    id uuid primary key default gen_random_uuid(),
    trigger text not null,
    triggered_by text references users (id) on delete set null,
    status text not null default 'running',
    dry_run boolean not null,
    bootcamp_id uuid references bootcamps (id) on delete set null,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    invited integer not null default 0,
    removed integer not null default 0,
    not_in_slack integer not null default 0,
    failures integer not null default 0,
    unfinished boolean not null default false,
    error text,
    constraint slack_sync_runs_trigger_check check (trigger in ('schedule', 'manual')),
    constraint slack_sync_runs_status_check check (status in ('running', 'succeeded', 'skipped', 'failed'))
  );
  create index if not exists slack_sync_runs_started_at_idx on slack_sync_runs (started_at);
  create unique index if not exists slack_sync_runs_one_running_idx
    on slack_sync_runs (status) where status = 'running';

  create table if not exists slack_sync_changes (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references slack_sync_runs (id) on delete cascade,
    channel_name text not null,
    action text not null,
    email text not null default '',
    detail text,
    at timestamptz not null default now()
  );
  create index if not exists slack_sync_changes_run_idx on slack_sync_changes (run_id, at);
end $$;

commit;

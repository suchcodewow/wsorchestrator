-- release_notice_runs / release_notice_messages: each sending of the Slack
-- message a release of BTC or INT scores sends to the class's managers and
-- the Additional Slack Contacts, or a preview of it, with one row per
-- recipient, for the log on Reporting Settings → Feedback Management.
--
-- Also forgets feedback_channels_live: the Live Sessions Slack button no
-- longer has a Test mode, and follows Slack's one dry run / live switch.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — tables created, the setting deleted
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists release_notice_runs (
    id uuid primary key default gen_random_uuid(),
    stage text not null,
    bootcamp_id uuid references bootcamps (id) on delete set null,
    triggered_by text references users (id) on delete set null,
    preview boolean not null default false,
    dry_run boolean not null,
    test_group boolean not null default false,
    status text not null default 'running',
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    recipients integer not null default 0,
    messaged integer not null default 0,
    not_in_slack integer not null default 0,
    failures integer not null default 0,
    error text,
    constraint release_notice_runs_stage_check check (stage in ('bootcamp', 'intermediate')),
    constraint release_notice_runs_status_check check (status in ('running', 'succeeded', 'failed'))
  );
  create index if not exists release_notice_runs_started_at_idx on release_notice_runs (started_at);

  create table if not exists release_notice_messages (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references release_notice_runs (id) on delete cascade,
    action text not null,
    email text not null,
    detail text,
    at timestamptz not null default now(),
    constraint release_notice_messages_action_check check (action in ('messaged', 'not_in_slack', 'failed'))
  );
  create index if not exists release_notice_messages_run_idx on release_notice_messages (run_id, at);

  delete from evals_settings where key = 'feedback_channels_live';
end
$$;

commit;

-- The Diagnostic's daily Slack reminders: each run, the schedule's or Remind
-- Now's on Diagnostic Settings → Slack, and each Participant it messaged, or
-- in a dry run would have, or could not. Live or dry run, and the day the
-- schedule last sent, are rows in iris_settings and need nothing here.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — tables created
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists iris_reminder_runs (
    id uuid primary key default gen_random_uuid(),
    trigger text not null,
    triggered_by text references users (id) on delete set null,
    dry_run boolean not null,
    status text not null default 'running',
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    due integer not null default 0,
    messaged integer not null default 0,
    not_in_slack integer not null default 0,
    failed integer not null default 0,
    note text,
    error text,
    constraint iris_reminder_runs_trigger_check check (trigger in ('schedule', 'manual')),
    constraint iris_reminder_runs_status_check check (status in ('running', 'succeeded', 'skipped', 'failed'))
  );
  create index if not exists iris_reminder_runs_started_at_idx on iris_reminder_runs (started_at);
  create unique index if not exists iris_reminder_runs_one_running_idx on iris_reminder_runs (status) where status = 'running';

  create table if not exists iris_reminder_messages (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references iris_reminder_runs (id) on delete cascade,
    email text not null,
    full_name text not null default '',
    outcome text not null,
    detail text not null default '',
    at timestamptz not null default now(),
    constraint iris_reminder_messages_outcome_check check (outcome in ('messaged', 'not_in_slack', 'failed'))
  );
  create index if not exists iris_reminder_messages_run_idx on iris_reminder_messages (run_id, at);
end
$$;

commit;

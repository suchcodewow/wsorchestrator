-- Slack: the app's install in the workspace, from Cohort Settings → Slack.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.slack_sync_runs') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists slack_installation (
    id boolean primary key default true,
    team_id text not null,
    team_name text,
    app_id text not null,
    bot_user_id text not null,
    scopes text not null,
    token bytea not null,
    installed_by text constraint slack_installation_installed_by_users_id_fk references users (id) on delete set null,
    installed_at timestamptz not null default now(),
    constraint slack_installation_one_row check (id)
  );
end $$;

commit;

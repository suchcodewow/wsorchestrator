-- feedback_channels: the private Slack channel each person on Reporting →
-- Live Sessions is discussed in, made the first time someone presses the
-- card's Slack button.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — table created
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists feedback_channels (
    attendee_email text primary key,
    name text not null,
    slack_channel_id text not null,
    created_by text references users (id) on delete set null,
    created_at timestamptz not null default now()
  );
  create unique index if not exists feedback_channels_name_idx on feedback_channels (name);
end
$$;

commit;

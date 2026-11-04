-- scorecard_views: who has opened each person's card on Reporting → Live
-- Sessions, how often, and when they last did, for the eye beside a name.
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

  create table if not exists scorecard_views (
    attendee_email text not null,
    viewer_id text not null references users (id) on delete cascade,
    views integer not null default 1,
    first_viewed_at timestamptz not null default now(),
    last_viewed_at timestamptz not null default now(),
    primary key (attendee_email, viewer_id)
  );
end
$$;

commit;

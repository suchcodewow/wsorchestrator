-- The Diagnostic's tests are for its Participants only, chosen on Diagnostic
-- Settings rather than by assessments role.
--
-- iris_participants: the Participants added by hand, by lowercased email.
-- iris_settings: Diagnostic-wide settings, starting with Bootcamp
-- Auto-Enroll, which makes bootcamp attendees Participants while it is on.
--
-- Everyone who already has a live sitting is added by hand when the table is
-- first made, so they can carry on with the subjects they have left. That
-- happens once: a later run finds the table and adds no one.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — tables created, existing takers added
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  if to_regclass('public.iris_participants') is null then
    create table iris_participants (
      email text primary key,
      added_by text references users (id) on delete set null,
      added_at timestamptz not null default now()
    );
    insert into iris_participants (email)
      select distinct lower(u.email)
        from iris_attempts a
        join users u on u.id = a.user_id
       where a.mode = 'live' and u.email is not null
      on conflict do nothing;
  end if;

  create table if not exists iris_settings (
    key text primary key,
    value text not null,
    updated_by text references users (id) on delete set null,
    updated_at timestamptz not null default now()
  );
end
$$;

commit;

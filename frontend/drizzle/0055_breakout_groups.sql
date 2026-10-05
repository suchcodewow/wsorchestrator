-- Breakout groups: in a breakout, each attendee taught it goes with one of its
-- instructors to that instructor's room. One row per attendee assigned.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.schedule_sessions') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists schedule_session_groups (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references schedule_sessions (id) on delete cascade,
    email text not null,
    full_name text not null default '',
    instructor_email text not null,
    position integer not null default 0
  );
  create unique index if not exists schedule_session_groups_email_idx on schedule_session_groups (session_id, email);
end $$;

commit;

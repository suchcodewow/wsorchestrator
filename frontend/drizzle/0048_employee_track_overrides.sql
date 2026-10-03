-- employee_track_overrides: a track an administrator set for one person from
-- the Cohorts page's Current tab. It outranks the title lists, bootcamp
-- history and the deferral rule, and survives the HiBob sync that rebuilds
-- `employees`. A null track keeps the person undecided. One row per
-- lowercased email.
--
-- `employees.track` gains the value `deferred`; it is plain text, so that
-- needs no change here.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists employee_track_overrides (
    email text primary key,
    track text,
    updated_by text references users (id) on delete set null,
    updated_at timestamptz not null default now(),
    constraint employee_track_overrides_track_check
      check (track in ('sales', 'engineer', 'ignored', 'exempt', 'deferred'))
  );
end $$;

commit;

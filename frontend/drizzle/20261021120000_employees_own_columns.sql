-- What the app keeps about each employee now lives on `employees` itself,
-- because the HiBob sync updates rows in place rather than rewriting the table:
--
--   * timezone       — their usual IANA time zone; null until Slack or they say
--   * chosen_name    — the name they chose on the Pre-Bootcamp form
--                      (was employee_chosen_names)
--   * track_pinned / track_override — a track set by hand
--                      (was employee_track_overrides)
--   * active         — false once HiBob stops sending them; the row stays
--
-- The two old tables are copied in and then left alone, not dropped, so the
-- release still running while this migrates keeps working; a later migration
-- drops them. employee_timezones existed only on branches, never released.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — columns added and filled from the old tables
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table employees add column if not exists timezone text;
  alter table employees add column if not exists chosen_name text;
  alter table employees add column if not exists track_pinned boolean not null default false;
  alter table employees add column if not exists track_override text;
  alter table employees add column if not exists active boolean not null default true;

  if not exists (select 1 from pg_constraint where conname = 'employees_track_override_check') then
    alter table employees add constraint employees_track_override_check
      check (track_override in ('sales', 'engineer', 'ignored', 'exempt', 'deferred'));
  end if;

  if to_regclass('public.employee_chosen_names') is not null then
    update employees e set chosen_name = c.full_name
      from employee_chosen_names c
      where lower(e.email) = c.email and e.chosen_name is null;
  end if;

  if to_regclass('public.employee_track_overrides') is not null then
    update employees e set track_pinned = true, track_override = o.track
      from employee_track_overrides o
      where lower(e.email) = o.email and not e.track_pinned;
  end if;

  drop table if exists employee_timezones;
end $$;

commit;

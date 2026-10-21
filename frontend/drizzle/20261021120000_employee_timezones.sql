-- Where each employee normally is, as an IANA time zone: `employee_timezones`
-- keeps it across the HiBob sync, which rewrites `employees` wholesale and
-- copies it onto the new `employees.timezone`. The sync fills it from Slack
-- for anyone without one; the Pre-Bootcamp form lets them confirm or change
-- it. Starts empty.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — table and column added
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists employee_timezones (
    email text primary key,
    timezone text not null,
    source text not null,
    updated_by text
      constraint employee_timezones_updated_by_users_id_fk references users (id) on delete set null,
    updated_at timestamptz not null default now()
  );

  alter table employees add column if not exists timezone text;
end $$;

commit;

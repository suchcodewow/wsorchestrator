-- The name someone chose for themselves on the Pre-Bootcamp form, shown in
-- place of the one their email gives. Kept apart from `employees`, which the
-- HiBob sync rewrites wholesale and so re-applies it to each time. Starts
-- empty: everyone shows their email's name until they choose another.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists employee_chosen_names (
    email text primary key,
    full_name text not null,
    updated_by text
      constraint employee_chosen_names_updated_by_users_id_fk references users (id) on delete set null,
    updated_at timestamptz not null default now()
  );
end $$;

commit;

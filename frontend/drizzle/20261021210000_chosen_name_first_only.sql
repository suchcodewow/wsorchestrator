-- `employees.chosen_name` now holds only the preferred first name; the name the
-- app shows (`full_name`) is that first name with the official last name, which
-- the next HiBob sync works out again from the HiBob record. A chosen name
-- saved while the column held a whole name is cut to its first word here.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — whole chosen names cut to their first word
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.employees') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'employees' and column_name = 'chosen_name'
     ) then
    raise notice 'no employees.chosen_name yet — nothing to migrate';
    return;
  end if;

  update employees
  set chosen_name = split_part(btrim(chosen_name), ' ', 1)
  where chosen_name is not null and btrim(chosen_name) like '% %';
end
$$;

commit;

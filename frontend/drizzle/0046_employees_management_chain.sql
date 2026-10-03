-- employees.management_chain: the lowercased emails from a person's manager up
-- to and including the Organization Leader, joined with `;` as the Sheet's
-- Management Chain column was. The HiBob sync sets it alongside org_depth and
-- leaves it null wherever org_depth is.
--
-- The people already stored are filled in from their reports_to_email links,
-- walked up org_depth steps, so the chain is there before the next sync. A walk
-- that cannot be completed from the stored rows leaves the chain null until
-- the next sync writes it.
--
-- Safe to run on any database, and again on one restored from a backup:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — column added and filled in as above
--   * already migrated — nobody left to fill in, so a no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table employees add column if not exists management_chain text;

  with recursive walk (id, depth, manager, chain) as (
    select e.id, e.org_depth, e.reports_to_email, array[e.reports_to_email]
      from employees e
     where e.org_depth is not null
       and e.management_chain is null
       and e.reports_to_email <> ''
    union all
    select w.id, w.depth, m.reports_to_email, w.chain || m.reports_to_email
      from walk w
      join employees m on m.email = w.manager
     where cardinality(w.chain) < w.depth
       and m.reports_to_email <> ''
  )
  update employees e
     set management_chain = c.chain
    from (
      select distinct on (id) id, array_to_string(chain, ';') as chain
        from walk
       where cardinality(chain) = depth
       order by id
    ) c
   where e.id = c.id;
end $$;

commit;

-- The Organization tab reads `employees` rather than its own copy of it:
--
--   * employees.org_depth is the links between a person and the Organization
--     Leader, the leader included, as the sync that stored them worked it out;
--     null for anyone not under the leader. It replaces
--     evals_organization_members.depth, and the rest of that table's columns
--     were already on `employees`.
--   * hibob_sync_runs.org_leader_email records, once per sync, whom that
--     sync worked org_depth out for. It replaces the leader_email repeated on
--     every evals_organization_members row.
--
-- Both are backfilled from evals_organization_members, so the tab is not empty
-- until the next sync. 0041 then drops that table.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — columns added and backfilled as above
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table employees add column if not exists org_depth integer;
  alter table hibob_sync_runs add column if not exists org_leader_email text;

  if to_regclass('public.evals_organization_members') is null then
    raise notice 'no evals_organization_members — nothing to backfill';
    return;
  end if;

  -- Only into a database no new sync has written yet: once one has, its
  -- org_depth values are the current ones and the old table is stale.
  if not exists (select 1 from employees where org_depth is not null) then
    update employees e
       set org_depth = m.depth
      from evals_organization_members m
     where lower(e.email) = m.email;

    -- The run that wrote those rows: the latest to succeed.
    update hibob_sync_runs
       set org_leader_email = (select min(leader_email) from evals_organization_members)
     where id = (
             select id from hibob_sync_runs
              where status = 'succeeded'
              order by started_at desc
              limit 1
           )
       and org_leader_email is null;
  end if;
end $$;

commit;

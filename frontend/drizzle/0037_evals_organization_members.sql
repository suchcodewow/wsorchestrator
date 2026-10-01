-- `evals_organization_members`: everyone under the Organization Leader (set on
-- Cohort Settings → Automation, stored in `evals_settings` by 0036), as of the
-- last HiBob sync. The sync rewrites it from scratch (see
-- syncHibobEmployees), so it never needs an update statement here. Read by
-- the Cohort Settings → Organization tab.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-feature      — the table is created
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'no users table — nothing to attach the organization snapshot to';
    return;
  end if;

  create table if not exists evals_organization_members (
    email text primary key,
    full_name text not null,
    title text not null default '',
    department text not null default '',
    reports_to_email text not null default '',
    reports_to_name text not null default '',
    depth integer not null,
    leader_email text not null
  );
end $$;

commit;

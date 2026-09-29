-- HiBob's credentials move out of the database and into the deployment
-- (hibob_userid / hibob_token in terraform.tfvars, the app's env on Cloud Run),
-- and the sync gains a schedule and a log:
--
--   * hibob_employees is renamed employees. Rows, and their ids, carry over.
--   * hibob_sync_runs logs every sync, scheduled or manual, and how it ended.
--     The connection row's last import, if there was one, becomes its first
--     entry.
--   * hibob_connection, which held the sealed token, is dropped.
--
-- A view named hibob_employees stands in for the old table, because this runs
-- before the new image goes live and the revision still serving reads (and
-- imports into) that name. It is a plain view over one table, so Postgres lets
-- that revision delete and insert through it too. Nothing in the new code reads
-- it; a later migration can drop it.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — renamed, created, backfilled and dropped as above
--   * already migrated — every step is a guarded no-op
--   * pushed, then run  — an empty hibob_employees table left by 0033 is
--                        replaced with the view

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  -- relkind 'r' because once renamed, hibob_employees is the view.
  if exists (select 1 from pg_class where relname = 'hibob_employees' and relkind = 'r')
     and to_regclass('public.employees') is null then
    alter table hibob_employees rename to employees;
    alter index if exists hibob_employees_pkey rename to employees_pkey;
    alter index if exists hibob_employees_email_idx rename to employees_email_idx;
    alter index if exists hibob_employees_reports_to_idx rename to employees_reports_to_idx;
  else
    raise notice 'hibob_employees already renamed — skipped';
  end if;

  create table if not exists employees (
    id text primary key,
    email text not null,
    full_name text not null,
    title text not null default '',
    department text not null default '',
    site text not null default '',
    reports_to_email text not null default '',
    reports_to_name text not null default '',
    start_date date,
    active_effective_date date,
    raw jsonb not null,
    imported_at timestamptz not null default now()
  );
  create index if not exists employees_email_idx on employees (email);
  create index if not exists employees_reports_to_idx on employees (reports_to_email);

  -- Before 0033 learned to skip them, a database built by db:push and then
  -- migrated got an empty hibob_employees table beside employees (QA did).
  -- Drop it so the view goes in, as everywhere else. One with rows is left.
  if exists (select 1 from pg_class where relname = 'hibob_employees' and relkind = 'r')
     and to_regclass('public.employees') is not null then
    if exists (select 1 from hibob_employees) then
      raise notice 'hibob_employees is a table with rows beside employees — left alone';
    else
      drop table hibob_employees;
    end if;
  end if;

  if to_regclass('public.hibob_employees') is null then
    create view hibob_employees as select * from employees;
  end if;

  create table if not exists hibob_sync_runs (
    id uuid primary key default gen_random_uuid(),
    trigger text not null,
    triggered_by text references users(id) on delete set null,
    status text not null default 'running',
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    employee_count integer,
    skipped integer,
    error text
  );
  create index if not exists hibob_sync_runs_started_at_idx on hibob_sync_runs (started_at);
  -- One sync at a time: a second insert while one runs is a conflict.
  create unique index if not exists hibob_sync_runs_one_running_idx
    on hibob_sync_runs (status) where status = 'running';

  if to_regclass('public.hibob_connection') is not null then
    insert into hibob_sync_runs (trigger, triggered_by, status, started_at, finished_at, employee_count, skipped)
    select 'manual', last_import_by, 'succeeded', last_import_at, last_import_at, last_import_count, 0
    from hibob_connection
    where last_import_at is not null
      and not exists (select 1 from hibob_sync_runs);

    drop table hibob_connection;
  end if;
end $$;

commit;

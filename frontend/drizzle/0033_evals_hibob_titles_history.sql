-- eVals' first data: the HiBob connection and its employee import, the title
-- lists that sort attendees into Sales and Engineer (or ignore them), and
-- bootcamp history — who has attended BTC and INT, and how they scored.
--
-- Nothing is backfilled. Bootcamp history is uploaded from the sheet on the
-- Attendee tracking tab; employees arrive with the first HiBob import.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before eVals data — the four tables and their indexes are created
--   * already migrated — every step is a guarded no-op
--   * after 0034       — the two HiBob tables are skipped. 0034 renamed
--                        hibob_employees to employees, left a view under the
--                        old name, and dropped hibob_connection. Without this
--                        guard a re-run tried to index that view, and every
--                        deploy after 0034 failed here.

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  -- employees exists once 0034 has run, or when db:push built the schema.
  if to_regclass('public.employees') is null then
    create table if not exists hibob_connection (
      id text primary key default 'site',
      service_user_id text not null,
      secret bytea not null,
      tail text not null,
      updated_by text references users(id) on delete set null,
      updated_at timestamptz not null default now(),
      last_import_at timestamptz,
      last_import_count integer,
      last_import_by text references users(id) on delete set null,
      last_import_error text
    );

    create table if not exists hibob_employees (
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
    create index if not exists hibob_employees_email_idx on hibob_employees (email);
    create index if not exists hibob_employees_reports_to_idx on hibob_employees (reports_to_email);
  else
    raise notice 'hibob tables already moved to employees by 0034 — skipped';
  end if;

  create table if not exists evals_titles (
    id uuid primary key default gen_random_uuid(),
    list text not null,
    title text not null,
    created_by text references users(id) on delete set null,
    created_at timestamptz not null default now()
  );
  create unique index if not exists evals_titles_title_idx on evals_titles (lower(title));

  create table if not exists bootcamp_history (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    btc_date date,
    int_date date,
    btc_score double precision,
    int_score double precision,
    btc_individual_scores jsonb,
    int_individual_scores jsonb,
    updated_by text references users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index if not exists bootcamp_history_email_idx on bootcamp_history (email);
end $$;

commit;

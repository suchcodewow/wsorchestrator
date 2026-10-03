-- Two changes for the Scheduler and the Cohorts page's Current tab.
--
-- bootcamp_history.btc_score and int_score may now be any score from 1 to 4,
-- which the app keeps to one decimal place, rather than a whole number: an
-- overall score is an average of exercise scores. 0043's constraints of the
-- same names are replaced. Stored scores are left as they are.
--
-- bootcamps: each bootcamp the Scheduler plans, BTC over btc_days from
-- start_date with INT alongside it unless int_days is null. A partial unique
-- index allows one active bootcamp at a time.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the constraints are replaced and the table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  if exists (
    select 1 from pg_constraint
     where conname = 'bootcamp_history_btc_score_check'
       and pg_get_constraintdef(oid) like '%= ANY%'  -- 0043's in (1, 2, 3, 4)
  ) then
    alter table bootcamp_history drop constraint bootcamp_history_btc_score_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bootcamp_history_btc_score_check') then
    alter table bootcamp_history
      add constraint bootcamp_history_btc_score_check check (btc_score between 1 and 4);
  end if;

  if exists (
    select 1 from pg_constraint
     where conname = 'bootcamp_history_int_score_check'
       and pg_get_constraintdef(oid) like '%= ANY%'  -- 0043's in (1, 2, 3, 4)
  ) then
    alter table bootcamp_history drop constraint bootcamp_history_int_score_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bootcamp_history_int_score_check') then
    alter table bootcamp_history
      add constraint bootcamp_history_int_score_check check (int_score between 1 and 4);
  end if;

  create table if not exists bootcamps (
    id uuid primary key default gen_random_uuid(),
    start_date date not null,
    btc_days integer not null,
    int_days integer,
    status text not null default 'scheduled',
    created_by text references users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint bootcamps_status_check check (status in ('scheduled', 'active')),
    constraint bootcamps_btc_days_check check (btc_days between 1 and 30),
    constraint bootcamps_int_days_check check (int_days between 1 and 30)
  );
  create index if not exists bootcamps_start_date_idx on bootcamps (start_date);
  create unique index if not exists bootcamps_one_active_idx on bootcamps (status) where status = 'active';
end $$;

commit;

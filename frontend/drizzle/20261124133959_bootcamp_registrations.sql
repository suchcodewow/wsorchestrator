-- bootcamp_registrations: who registered for which class, one row per
-- bootcamp, class and person, written when they save their stage's
-- registration form. Until now a registration was only the form's answers in
-- intake_responses, tied to no bootcamp, so a sign-up for the next class read
-- as one for whichever bootcamp Live Sessions showed.
--
-- The backfill gives everyone who has saved a form for a class they have not
-- attended yet a row at the next bootcamp holding that class: the active one,
-- else the soonest scheduled one that has not started. That is who the
-- current class lists counted before. Someone deferred, ignored or exempt, or
-- no longer sent by HiBob, gets none.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — table and indexes created, then the backfill
--   * already migrated — every step is a guarded no-op; a row already there is kept

begin;

do $$
begin
  if to_regclass('public.bootcamps') is null or to_regclass('public.intake_responses') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists bootcamp_registrations (
    bootcamp_id uuid not null
      constraint bootcamp_registrations_bootcamp_id_bootcamps_id_fk references bootcamps (id) on delete cascade,
    stage text not null,
    email text not null,
    test boolean not null default false,
    registered_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint bootcamp_registrations_bootcamp_id_stage_email_pk primary key (bootcamp_id, stage, email),
    constraint bootcamp_registrations_stage_check check (stage in ('bootcamp', 'intermediate'))
  );

  create index if not exists bootcamp_registrations_email_idx on bootcamp_registrations (email);

  insert into bootcamp_registrations (bootcamp_id, stage, email, test, registered_at, updated_at)
  select nb.id, r.form, r.email, r.test, r.first_at, r.last_at
    from (
      select form, email, bool_or(test) as test, min(submitted_at) as first_at, max(submitted_at) as last_at
        from intake_responses
       group by form, email
    ) r
    cross join lateral (
      select b.id from bootcamps b
       where (b.status = 'active' or (b.status = 'scheduled' and b.start_date >= current_date))
         and (r.form = 'bootcamp' or b.int_days is not null)
       order by (b.status = 'active') desc, b.start_date
       limit 1
    ) nb
   where (r.test or exists (
            select 1 from employees e
             where lower(e.email) = r.email and e.active
               and coalesce(e.track, '') not in ('deferred', 'ignored', 'exempt')))
     -- Attended: scored in a released class of that stage.
     and not exists (
           select 1 from evals_submissions s
             join evals_assessments a on a.id = s.assessment_id
             join bootcamps b on b.id = s.bootcamp_id
            where s.attendee_email = r.email and a.stage = r.form
              and (case r.form when 'bootcamp' then b.btc_released_at else b.int_released_at end) is not null)
  on conflict do nothing;
end $$;

commit;

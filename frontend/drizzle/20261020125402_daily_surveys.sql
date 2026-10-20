-- daily_surveys: the survey one stage's attendees on one employee track fill
-- in about one day of a bootcamp, with the day's sessions copied in when the
-- scheduler's "Assign Surveys" sent it. daily_survey_assignments: each
-- person's copy of one, and their answers once given.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — tables and indexes created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists daily_surveys (
    id uuid primary key default gen_random_uuid(),
    bootcamp_id uuid not null
      constraint daily_surveys_bootcamp_id_bootcamps_id_fk references bootcamps (id) on delete cascade,
    stage text not null,
    day integer not null,
    audience text not null,
    sessions jsonb not null default '[]'::jsonb,
    created_by text
      constraint daily_surveys_created_by_users_id_fk references users (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint daily_surveys_stage_check check (stage in ('bootcamp', 'intermediate')),
    constraint daily_surveys_audience_check check (audience in ('sales', 'engineer')),
    constraint daily_surveys_day_check check (day between 1 and 30)
  );

  create unique index if not exists daily_surveys_day_idx on daily_surveys (bootcamp_id, stage, day, audience);

  create table if not exists daily_survey_assignments (
    id uuid primary key default gen_random_uuid(),
    survey_id uuid not null
      constraint daily_survey_assignments_survey_id_daily_surveys_id_fk references daily_surveys (id) on delete cascade,
    email text not null,
    full_name text not null default '',
    assigned_at timestamptz not null default now(),
    session_answers jsonb,
    day_rating integer,
    day_change text not null default '',
    submitted_at timestamptz,
    constraint daily_survey_assignments_day_rating_check check (day_rating between 1 and 5)
  );

  create unique index if not exists daily_survey_assignments_person_idx on daily_survey_assignments (survey_id, email);
  create index if not exists daily_survey_assignments_email_idx on daily_survey_assignments (email, assigned_at);
end $$;

commit;

-- eVals assessments: what attendees are scored on, defined in eVals Settings →
-- Assessments, and the scores given on the eVals page during the active
-- bootcamp. Criteria and scores are rows, so changing an assessment never
-- adds a column. Also bootcamp_judges: the guest judges the Scheduler adds to
-- a bootcamp, who can score while it is active.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — tables created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists bootcamp_judges (
    id uuid primary key default gen_random_uuid(),
    bootcamp_id uuid not null references bootcamps (id) on delete cascade,
    email text not null,
    full_name text not null default '',
    added_by text references users (id) on delete set null,
    added_at timestamptz not null default now()
  );
  create unique index if not exists bootcamp_judges_bootcamp_email_idx on bootcamp_judges (bootcamp_id, email);
  create index if not exists bootcamp_judges_email_idx on bootcamp_judges (email);

  create table if not exists evals_assessments (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    stage text not null,
    audience text not null,
    active boolean not null default true,
    created_by text references users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint evals_assessments_stage_check check (stage in ('bootcamp', 'intermediate')),
    constraint evals_assessments_audience_check check (audience in ('sales', 'engineer', 'both'))
  );
  create index if not exists evals_assessments_stage_idx on evals_assessments (stage, active);

  create table if not exists evals_assessment_criteria (
    id uuid primary key default gen_random_uuid(),
    assessment_id uuid not null references evals_assessments (id) on delete cascade,
    position integer not null,
    name text not null,
    description text not null default '',
    retired_at timestamptz,
    created_at timestamptz not null default now()
  );
  create index if not exists evals_assessment_criteria_assessment_idx
    on evals_assessment_criteria (assessment_id, position);

  create table if not exists evals_submissions (
    id uuid primary key default gen_random_uuid(),
    bootcamp_id uuid not null references bootcamps (id) on delete restrict,
    assessment_id uuid not null references evals_assessments (id) on delete restrict,
    attendee_email text not null,
    assessment_name text not null,
    average_score double precision not null,
    positive_feedback text not null default '',
    constructive_feedback text not null default '',
    owner_id text references users (id) on delete set null,
    submitted_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint evals_submissions_average_check check (average_score between 1 and 4)
  );
  create unique index if not exists evals_submissions_one_idx
    on evals_submissions (bootcamp_id, assessment_id, attendee_email);
  create index if not exists evals_submissions_assessment_idx on evals_submissions (assessment_id);

  create table if not exists evals_submission_scores (
    submission_id uuid not null references evals_submissions (id) on delete cascade,
    criterion_id uuid not null references evals_assessment_criteria (id) on delete restrict,
    criterion_name text not null,
    score integer not null,
    comment text not null default '',
    primary key (submission_id, criterion_id),
    constraint evals_submission_scores_score_check check (score between 1 and 4)
  );
  create index if not exists evals_submission_scores_criterion_idx on evals_submission_scores (criterion_id);
end $$;

commit;

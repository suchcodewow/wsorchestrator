-- eVals transcripts: the transcript of each recording a judge makes while
-- scoring an attendee, filed by bootcamp, assessment and attendee as their
-- submission is. The audio stays in the judge's browser.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.evals_submissions') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists evals_transcripts (
    id uuid primary key default gen_random_uuid(),
    bootcamp_id uuid not null references bootcamps (id) on delete restrict,
    assessment_id uuid not null references evals_assessments (id) on delete restrict,
    attendee_email text not null,
    recording_id uuid not null,
    recorded_by_id text references users (id) on delete set null,
    recorded_by_name text not null default '',
    recorded_at timestamptz not null,
    duration_ms integer not null,
    text text not null,
    created_at timestamptz not null default now()
  );
  create unique index if not exists evals_transcripts_recording_idx on evals_transcripts (recording_id);
  create index if not exists evals_transcripts_attendee_idx
    on evals_transcripts (bootcamp_id, assessment_id, attendee_email, recorded_at);
  create index if not exists evals_transcripts_assessment_idx on evals_transcripts (assessment_id);
end $$;

commit;

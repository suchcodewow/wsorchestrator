-- bootcamp_class_reviews: an administrator's overall view of one attendee in
-- one class — overall positive and constructive feedback for their manager,
-- and the entrance and exit exam percentages, whose average counts towards
-- the class's overall score — and other notes, shown to the manager when
-- there are any.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — table created
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.bootcamps') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists bootcamp_class_reviews (
    bootcamp_id uuid not null references bootcamps (id) on delete cascade,
    stage text not null,
    attendee_email text not null,
    positive_feedback text not null default '',
    constructive_feedback text not null default '',
    other_notes text not null default '',
    entrance_exam double precision,
    exit_exam double precision,
    updated_by text references users (id) on delete set null,
    updated_at timestamptz not null default now(),
    primary key (bootcamp_id, stage, attendee_email),
    constraint bootcamp_class_reviews_stage_check check (stage in ('bootcamp', 'intermediate')),
    constraint bootcamp_class_reviews_entrance_check check (entrance_exam between 0 and 100),
    constraint bootcamp_class_reviews_exit_check check (exit_exam between 0 and 100)
  );
  alter table bootcamp_class_reviews add column if not exists other_notes text not null default '';
  create index if not exists bootcamp_class_reviews_attendee_email_idx on bootcamp_class_reviews (attendee_email);
end
$$;

commit;

-- participation: judges mark attendees against descriptors through a live
-- session, and a built-in assessment for each stage holds what is generated
-- from those marks. The built-in assessments stay inactive, so no judge is
-- offered them; they are named by `built_in` and hold no criteria.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — tables created, each stage's assessment named
--                        Participation taken over or one added, and the
--                        starting descriptors added
--   * already migrated — nothing changes; descriptors are only added to an
--                        empty table, and taking one off the list retires it

begin;

do $$
begin
  if to_regclass('public.evals_assessments') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table evals_assessments add column if not exists built_in text;
  create unique index if not exists evals_assessments_built_in_idx
    on evals_assessments (built_in, stage) where built_in is not null;

  create table if not exists participation_descriptors (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    polarity text not null,
    position integer not null,
    retired_at timestamptz,
    created_by text references users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint participation_descriptors_polarity_check check (polarity in ('positive', 'negative'))
  );
  create index if not exists participation_descriptors_position_idx
    on participation_descriptors (polarity, position);

  create table if not exists participation_marks (
    bootcamp_id uuid not null references bootcamps (id) on delete cascade,
    stage text not null,
    attendee_email text not null,
    descriptor_id uuid not null references participation_descriptors (id) on delete cascade,
    count integer not null default 0,
    updated_at timestamptz not null default now(),
    primary key (bootcamp_id, stage, attendee_email, descriptor_id),
    constraint participation_marks_stage_check check (stage in ('bootcamp', 'intermediate')),
    constraint participation_marks_count_check check (count between 0 and 3)
  );
  create index if not exists participation_marks_descriptor_idx on participation_marks (descriptor_id);

  create table if not exists participation_mark_events (
    id uuid primary key default gen_random_uuid(),
    bootcamp_id uuid not null references bootcamps (id) on delete cascade,
    stage text not null,
    attendee_email text not null,
    descriptor_id uuid not null references participation_descriptors (id) on delete cascade,
    delta integer not null,
    actor_id text references users (id) on delete set null,
    actor_name text not null,
    created_at timestamptz not null default now(),
    constraint participation_mark_events_delta_check check (delta in (-1, 1))
  );
  create index if not exists participation_mark_events_attendee_idx
    on participation_mark_events (bootcamp_id, stage, attendee_email);
  create index if not exists participation_mark_events_descriptor_idx on participation_mark_events (descriptor_id);

  -- A stage may already have an assessment named Participation, scored by hand.
  -- It becomes the built-in one, so its history stays and judges stop seeing it.
  update evals_assessments a
  set built_in = 'participation', active = false, updated_at = now()
  where a.id in (
    select distinct on (x.stage) x.id
    from evals_assessments x
    where x.built_in is null and lower(x.name) = 'participation'
    order by x.stage, x.created_at, x.id
  )
  and not exists (
    select 1 from evals_assessments b where b.built_in = 'participation' and b.stage = a.stage
  );

  insert into evals_assessments (name, stage, audience, active, built_in)
  select 'Participation', s.stage, 'both', false, 'participation'
  from (values ('bootcamp'), ('intermediate')) s(stage)
  where not exists (
    select 1 from evals_assessments a where a.built_in = 'participation' and a.stage = s.stage
  );

  if not exists (select 1 from participation_descriptors) then
    insert into participation_descriptors (name, polarity, position)
    values
      ('Actively participates', 'positive', 0),
      ('Comes prepared', 'positive', 1),
      ('Asks good questions', 'positive', 2),
      ('Gives useful feedback', 'positive', 3),
      ('Listens attentively', 'positive', 4),
      ('Eager to learn and coachable', 'positive', 5),
      ('Reads the room', 'positive', 6),
      ('Leads and coaches peers', 'positive', 7),
      ('Needs to speak up more', 'negative', 0),
      ('Doesn''t commit to exercises', 'negative', 1),
      ('Defensive or closed to new ideas', 'negative', 2),
      ('Hard to follow', 'negative', 3),
      ('Dominates or disrupts discussion', 'negative', 4),
      ('Distracted or absent', 'negative', 5);
  end if;
end $$;

commit;

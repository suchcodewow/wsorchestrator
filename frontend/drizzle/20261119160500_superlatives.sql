-- superlative_lists: the standing list of superlatives a Bootcamp's survey
-- asks, edited on Logistics settings. superlative_surveys: one Bootcamp's
-- superlatives survey, with the list and the class copied in when its
-- schedule's "Send Superlatives" sent it. superlative_assignments: each
-- person's copy of one, and their votes once given.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — tables and indexes created, and the starting list saved
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists superlative_lists (
    id text primary key,
    superlatives jsonb not null default '[]'::jsonb,
    updated_by text
      constraint superlative_lists_updated_by_users_id_fk references users (id) on delete set null,
    updated_at timestamptz not null default now(),
    constraint superlative_lists_id_check check (id = 'bootcamp')
  );

  create table if not exists superlative_surveys (
    id uuid primary key default gen_random_uuid(),
    bootcamp_id uuid not null
      constraint superlative_surveys_bootcamp_id_bootcamps_id_fk references bootcamps (id) on delete cascade,
    superlatives jsonb not null default '[]'::jsonb,
    nominees jsonb not null default '[]'::jsonb,
    created_by text
      constraint superlative_surveys_created_by_users_id_fk references users (id) on delete set null,
    created_at timestamptz not null default now(),
    unassigned_at timestamptz
  );

  create unique index if not exists superlative_surveys_bootcamp_idx on superlative_surveys (bootcamp_id);

  create table if not exists superlative_assignments (
    id uuid primary key default gen_random_uuid(),
    survey_id uuid not null
      constraint superlative_assignments_survey_id_superlative_surveys_id_fk references superlative_surveys (id) on delete cascade,
    email text not null,
    full_name text not null default '',
    assigned_at timestamptz not null default now(),
    votes jsonb,
    submitted_at timestamptz
  );

  create unique index if not exists superlative_assignments_person_idx on superlative_assignments (survey_id, email);
  create index if not exists superlative_assignments_email_idx on superlative_assignments (email, assigned_at);

  -- The list the training team starts from; Logistics settings edits it, and
  -- a list already saved is left as it is.
  insert into superlative_lists (id, superlatives)
  values (
    'bootcamp',
    '[{"id": "likely-cro", "title": "Most likely to be a CRO"},
      {"id": "outsmart-instructor", "title": "Most Likely to Outsmart the Instructor"}]'::jsonb
  )
  on conflict (id) do nothing;
end $$;

commit;

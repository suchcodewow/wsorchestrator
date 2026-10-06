-- Iris: who takes the placement tests and in which track, each sitting and
-- every answer in it, and which questions are approved. The questions
-- themselves live in code (src/lib/iris/items.ts).
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the tables created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists iris_takers (
    user_id text primary key
      constraint iris_takers_user_id_users_id_fk references users (id) on delete cascade,
    track text not null,
    updated_at timestamptz not null default now(),
    constraint iris_takers_track_check check (track in ('AE', 'SE', 'SDR'))
  );

  create table if not exists iris_attempts (
    id uuid primary key default gen_random_uuid(),
    user_id text not null
      constraint iris_attempts_user_id_users_id_fk references users (id) on delete cascade,
    subject text not null,
    form text not null,
    mode text not null,
    level integer not null,
    up integer not null default 0,
    down integer not null default 0,
    phase text not null default 'main',
    tie_left integer not null default 0,
    current_item_id text,
    shown_at timestamptz,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    placement integer,
    confidence text,
    questions integer not null default 0,
    constraint iris_attempts_form_check check (form in ('A', 'B')),
    constraint iris_attempts_mode_check check (mode in ('live', 'preview')),
    constraint iris_attempts_level_check check (level between 1 and 3),
    constraint iris_attempts_phase_check check (phase in ('main', 'tiebreak')),
    constraint iris_attempts_placement_check check (placement is null or placement between 1 and 3)
  );
  create unique index if not exists iris_attempts_one_live_idx
    on iris_attempts (user_id, subject, form) where mode = 'live';
  create index if not exists iris_attempts_finished_idx on iris_attempts (form, finished_at);

  create table if not exists iris_responses (
    attempt_id uuid not null
      constraint iris_responses_attempt_id_iris_attempts_id_fk references iris_attempts (id) on delete cascade,
    seq integer not null,
    item_id text not null,
    item_version text not null,
    level integer not null,
    subtopic text not null,
    choice integer not null,
    correct boolean not null,
    ms integer not null,
    phase text not null,
    answered_at timestamptz not null default now(),
    constraint iris_responses_attempt_id_seq_pk primary key (attempt_id, seq),
    constraint iris_responses_choice_check check (choice between -1 and 3)
  );
  create index if not exists iris_responses_item_idx on iris_responses (item_id, item_version);

  create table if not exists iris_item_reviews (
    item_id text primary key,
    item_version text not null,
    status text not null,
    note text not null default '',
    reviewer_id text
      constraint iris_item_reviews_reviewer_id_users_id_fk references users (id) on delete set null,
    updated_at timestamptz not null default now(),
    constraint iris_item_reviews_status_check check (status in ('approved', 'rejected', 'draft'))
  );
end $$;

commit;

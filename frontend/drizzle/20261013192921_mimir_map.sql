-- Mimir's concept map: the map's imported content, each person's progress
-- through each concept's video and their standing with the coach, and the
-- map coach's one conversation per person.
--
-- No content is created here. The repository is public and the content is
-- not, so it is imported in Mimir Settings → Map instead.
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

  create table if not exists mimir_map (
    id text primary key,
    content jsonb not null,
    imported_by text
      constraint mimir_map_imported_by_users_id_fk references users (id) on delete set null,
    imported_at timestamptz not null default now()
  );

  create table if not exists mimir_concept_progress (
    user_id text not null
      constraint mimir_concept_progress_user_id_users_id_fk references users (id) on delete cascade,
    concept_id text not null,
    video_seconds double precision not null default 0,
    video_furthest double precision not null default 0,
    video_duration double precision not null default 0,
    video_completed_at timestamptz,
    video_updated_at timestamptz,
    mastered_at timestamptz,
    recommended_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint mimir_concept_progress_user_id_concept_id_pk primary key (user_id, concept_id)
  );

  create table if not exists mimir_coach_conversations (
    user_id text primary key
      constraint mimir_coach_conversations_user_id_users_id_fk references users (id) on delete cascade,
    model text not null,
    system_prompt text not null,
    state_hash text not null default '',
    started_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists mimir_coach_messages (
    user_id text not null,
    seq integer not null,
    role text not null,
    shown boolean not null default true,
    content jsonb not null,
    text text not null,
    usage jsonb,
    created_at timestamptz not null default now(),
    constraint mimir_coach_messages_user_id_seq_pk primary key (user_id, seq),
    constraint mimir_coach_messages_user_fk foreign key (user_id) references mimir_coach_conversations (user_id) on delete cascade,
    constraint mimir_coach_messages_role_check check (role in ('user', 'assistant'))
  );
end $$;

commit;

-- Mimir: the reference content reps learn from and are coached on, each
-- person's progress through it, their coaching conversations, what they have
-- told the coach about themselves, and the Mimir-wide coaching settings.
--
-- No content is created here. The repository is public and the content is
-- not, so it is imported in Mimir Settings → Content instead.
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

  create table if not exists mimir_items (
    id text primary key,
    kind text not null,
    parent_id text
      constraint mimir_items_parent_id_mimir_items_id_fk references mimir_items (id) on delete restrict,
    position integer not null default 0,
    title text not null,
    emoji text not null default '',
    color text not null default '',
    summary text not null default '',
    body text not null default '',
    sections jsonb not null default '[]'::jsonb,
    attrs jsonb not null default '{}'::jsonb,
    updated_by text
      constraint mimir_items_updated_by_users_id_fk references users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint mimir_items_kind_check check (kind in ('agent', 'capability', 'ai', 'architecture', 'sdlc', 'persona', 'competitor', 'proof', 'framework', 'discovery', 'question', 'category', 'term', 'intro'))
  );
  create index if not exists mimir_items_kind_idx on mimir_items (kind, position);
  create index if not exists mimir_items_parent_idx on mimir_items (parent_id, position);

  create table if not exists mimir_progress (
    user_id text not null
      constraint mimir_progress_user_id_users_id_fk references users (id) on delete cascade,
    item_id text not null
      constraint mimir_progress_item_id_mimir_items_id_fk references mimir_items (id) on delete cascade,
    first_visit_at timestamptz not null default now(),
    last_visit_at timestamptz not null default now(),
    practiced_at timestamptz,
    mastery_ready_at timestamptz,
    reflection text not null default '',
    constraint mimir_progress_user_id_item_id_pk primary key (user_id, item_id)
  );
  create index if not exists mimir_progress_item_idx on mimir_progress (item_id);

  create table if not exists mimir_conversations (
    id uuid primary key default gen_random_uuid(),
    user_id text not null
      constraint mimir_conversations_user_id_users_id_fk references users (id) on delete cascade,
    item_id text not null
      constraint mimir_conversations_item_id_mimir_items_id_fk references mimir_items (id) on delete cascade,
    mode text not null,
    model text not null,
    system_prompt text not null,
    started_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index if not exists mimir_conversations_one_idx on mimir_conversations (user_id, item_id);

  create table if not exists mimir_messages (
    conversation_id uuid not null
      constraint mimir_messages_conversation_id_mimir_conversations_id_fk references mimir_conversations (id) on delete cascade,
    seq integer not null,
    role text not null,
    shown boolean not null default true,
    content jsonb not null,
    text text not null,
    usage jsonb,
    created_at timestamptz not null default now(),
    constraint mimir_messages_conversation_id_seq_pk primary key (conversation_id, seq),
    constraint mimir_messages_role_check check (role in ('user', 'assistant'))
  );

  create table if not exists mimir_profiles (
    user_id text primary key
      constraint mimir_profiles_user_id_users_id_fk references users (id) on delete cascade,
    role text,
    coach_style text not null default 'socratic',
    updated_at timestamptz not null default now(),
    constraint mimir_profiles_role_check check (role is null or role in ('SDR', 'AE', 'SE')),
    constraint mimir_profiles_coach_style_check check (coach_style in ('socratic', 'direct'))
  );

  create table if not exists mimir_settings (
    key text primary key,
    value text not null,
    updated_by text
      constraint mimir_settings_updated_by_users_id_fk references users (id) on delete set null,
    updated_at timestamptz not null default now()
  );
end $$;

commit;

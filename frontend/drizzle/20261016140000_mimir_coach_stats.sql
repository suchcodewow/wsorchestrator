-- How each person uses the map coach: messages typed, the most concepts they
-- have ever had mastered, and how often they started a new conversation.
-- Kept for the people who run Mimir to read in the database; never shown to
-- the person it describes.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists mimir_coach_stats (
    user_id text primary key
      constraint mimir_coach_stats_user_id_users_id_fk references users (id) on delete cascade,
    messages_sent integer not null default 0,
    peak_mastered integer not null default 0,
    new_conversations integer not null default 0,
    updated_at timestamptz not null default now()
  );
end $$;

commit;

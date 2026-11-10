-- Training → Games: each game's setup, one row per game, saved from Games
-- settings. A game with no row plays its defaults; the first is Guess Who
-- (key guess_who), whose config holds its tool cards, its rounds' mystery
-- tools and its question cap.
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

  create table if not exists training_games (
    key text primary key,
    config jsonb not null,
    updated_by text
      constraint training_games_updated_by_users_id_fk references users (id) on delete set null,
    updated_at timestamptz not null default now()
  );
end $$;

commit;

-- Training → Games → Guess Who, shared with the room: one row per game a
-- facilitator opened to reps by its code. config is the setup the game
-- started with, state its play, and rev counts the changes so each screen
-- can tell when it is behind. Codes don't expire; the facilitator ends one.
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

  create table if not exists guess_who_sessions (
    code text primary key,
    config jsonb not null,
    state jsonb not null,
    rev integer not null default 0,
    created_by text
      constraint guess_who_sessions_created_by_users_id_fk references users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
end $$;

commit;

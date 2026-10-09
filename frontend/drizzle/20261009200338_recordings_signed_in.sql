-- Async recordings move from a secret, replaceable link to /record behind
-- Google sign-in: each stream belongs to the account that recorded it, and
-- the links table goes.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the column added, the link dropped
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table recording_tracks add column if not exists recorded_by text
    constraint recording_tracks_recorded_by_users_id_fk references users (id) on delete set null;
  alter table recording_tracks drop column if exists link_id;
  drop table if exists recording_links;
end $$;

commit;

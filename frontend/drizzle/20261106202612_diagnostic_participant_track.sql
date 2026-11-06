-- The track an administrator chooses on adding a Diagnostic Participant, kept
-- on their row for someone with no account yet. A track in iris_takers, the
-- one they chose or the administrator's once they have an account, wins.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — column and its check added
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.iris_participants') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table iris_participants add column if not exists track text;
  if not exists (select 1 from pg_constraint where conname = 'iris_participants_track_check') then
    alter table iris_participants
      add constraint iris_participants_track_check check (track is null or track in ('AE', 'SE', 'SDR'));
  end if;
end
$$;

commit;

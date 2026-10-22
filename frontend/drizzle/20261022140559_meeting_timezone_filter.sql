-- meeting_selections.timezone_from / timezone_to: an optional range of UTC
-- offsets, in whole hours, that a picked meeting covers. Both null means no
-- filter; with a range, only cohort members whose time zone falls inside it
-- are invited.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — columns and check added
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.meeting_selections') is null then
    raise notice 'no meeting_selections yet — nothing to migrate';
    return;
  end if;

  alter table meeting_selections add column if not exists timezone_from integer;
  alter table meeting_selections add column if not exists timezone_to integer;

  if not exists (select 1 from pg_constraint where conname = 'meeting_selections_timezone_check') then
    alter table meeting_selections add constraint meeting_selections_timezone_check check (
      (timezone_from is null and timezone_to is null)
      or (timezone_from between -12 and 14 and timezone_to between -12 and 14 and timezone_from <= timezone_to)
    );
  end if;
end
$$;

commit;

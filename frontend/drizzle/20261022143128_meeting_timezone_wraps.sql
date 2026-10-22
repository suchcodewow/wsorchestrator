-- meeting_selections.timezone_from / timezone_to may now run the long way
-- round: from after to (UTC+9 to UTC-6) covers the offsets from the first
-- eastward through the date line to the second. The check no longer requires
-- from <= to.
--
-- Safe to run on any database:
--   * no table / no check yet — skipped
--   * before this — the check is replaced
--   * already migrated — the check is left alone

begin;

do $$
begin
  if to_regclass('public.meeting_selections') is null then
    raise notice 'no meeting_selections yet — nothing to migrate';
    return;
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'meeting_selections_timezone_check'
      and conrelid = 'public.meeting_selections'::regclass
      and pg_get_constraintdef(oid) like '%<=%'
  ) then
    alter table meeting_selections drop constraint meeting_selections_timezone_check;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'meeting_selections_timezone_check') then
    alter table meeting_selections add constraint meeting_selections_timezone_check check (
      (timezone_from is null and timezone_to is null)
      or (timezone_from between -12 and 14 and timezone_to between -12 and 14)
    );
  end if;
end
$$;

commit;

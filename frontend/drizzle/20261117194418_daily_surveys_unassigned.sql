-- daily_surveys.unassigned_at: set while a day's survey is unassigned from the
-- scheduler. Attendees no longer see it; its answers stay for Survey Results.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — column added
--   * already migrated — a no-op

begin;

do $$
begin
  if to_regclass('public.daily_surveys') is null then
    raise notice 'no daily_surveys — nothing to migrate';
    return;
  end if;

  alter table daily_surveys add column if not exists unassigned_at timestamptz;
end $$;

commit;

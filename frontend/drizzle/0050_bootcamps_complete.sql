-- Bootcamps gain a third status, complete: one that has run. Making a bootcamp
-- active while another is asks to complete the other one first.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the status check is widened
--   * already migrated — the check is dropped and made again, the same

begin;

do $$
begin
  if to_regclass('public.bootcamps') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table bootcamps drop constraint if exists bootcamps_status_check;
  alter table bootcamps
    add constraint bootcamps_status_check check (status in ('scheduled', 'active', 'complete'));
end $$;

commit;

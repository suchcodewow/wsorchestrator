-- Marks an intake answer saved by a member of the cohort test group, so
-- turning the test group off can delete it without touching a real answer.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the column added
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.intake_responses') is null then
    raise notice 'no intake_responses — nothing to migrate';
    return;
  end if;

  alter table intake_responses add column if not exists test boolean not null default false;
end $$;

commit;

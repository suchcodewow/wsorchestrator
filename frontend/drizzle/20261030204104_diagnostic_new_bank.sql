-- The Diagnostic is redone: nine new subjects, five with a new 190-question
-- bank (version 3.0), levels named 101 / 201 / 301. Results from the old bank
-- do not carry over, so this deletes every sitting (their answers cascade) and
-- every question approval, once. Tracks people chose are kept.
--
-- It also adds where each sitting keeps the shuffled order of the options on
-- screen.
--
-- Run once, however often it is applied: the deletion happens only while
-- iris_attempts has no question_set column, and adding that column is the
-- last thing it does. Every sitting from then on is recorded on the
-- 2026-10 set, so a later run finds the column and deletes nothing.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — old results and approvals deleted, both columns added
--   * already migrated — both columns exist; nothing changes

begin;

do $$
begin
  if to_regclass('public.iris_attempts') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table iris_attempts add column if not exists option_order integer[];

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'iris_attempts' and column_name = 'question_set'
  ) then
    delete from iris_attempts;
    delete from iris_item_reviews;
    alter table iris_attempts add column question_set text not null default '2026-10';
  else
    raise notice 'question_set already recorded — nothing deleted';
  end if;
end $$;

commit;

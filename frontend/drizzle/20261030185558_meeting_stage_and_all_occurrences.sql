-- meeting_selections: a picked meeting is for Bootcamp or Intermediate, no
-- longer both; any picked for both is kept as Bootcamp. all_occurrences says
-- whether each person is invited to every occurrence until their class rather
-- than to one at a time; false, one at a time, is how every meeting ran before.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — rows moved, constraint narrowed, column added
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  update meeting_selections set stage = 'bootcamp' where stage = 'both';

  alter table meeting_selections drop constraint if exists meeting_selections_stage_check;
  alter table meeting_selections
    add constraint meeting_selections_stage_check check (stage in ('bootcamp', 'intermediate'));

  alter table meeting_selections add column if not exists all_occurrences boolean not null default false;
end $$;

commit;

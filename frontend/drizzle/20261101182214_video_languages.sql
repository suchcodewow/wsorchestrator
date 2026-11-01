-- video languages: a Mimir video can now be watched in Spanish as well as
-- English, as a file of its own. Each person's choice is kept, and feedback
-- records the version it was left on, since the same moment falls at a
-- different second in each. The translations themselves live in the map.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — columns added; existing feedback reads as English,
--                        with no file named
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.video_feedback') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table users add column if not exists video_language text not null default 'en';
  alter table video_feedback add column if not exists language text not null default 'en';
  alter table video_feedback add column if not exists video_object text;

  if not exists (select 1 from pg_constraint where conname = 'video_feedback_language_check') then
    alter table video_feedback add constraint video_feedback_language_check check (language in ('en', 'es'));
  end if;
end $$;

commit;

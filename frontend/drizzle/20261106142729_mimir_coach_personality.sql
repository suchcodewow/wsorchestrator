-- mimir_coach_personality: whose voice Coach Canary's chat speaks in — its
-- own, Coach Lasso's or Coach Taylor's. Only the voice changes; the course,
-- the checklists and how a concept is mastered stay the same.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — column and its check added
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.mimir_profiles') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table mimir_profiles add column if not exists coach_personality text not null default 'canary';
  if not exists (select 1 from pg_constraint where conname = 'mimir_profiles_coach_personality_check') then
    alter table mimir_profiles
      add constraint mimir_profiles_coach_personality_check check (coach_personality in ('canary', 'lasso', 'taylor'));
  end if;
end
$$;

commit;

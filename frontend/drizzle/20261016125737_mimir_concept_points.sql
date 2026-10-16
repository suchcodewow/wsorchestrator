-- The map coach checks a concept point by point: each person's checklist for
-- a concept, and which of its main points they have covered, so a rep who has
-- said half of it is asked only for the other half.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the column added
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.mimir_concept_progress') is null then
    raise notice 'no mimir_concept_progress — nothing to migrate';
    return;
  end if;

  alter table mimir_concept_progress add column if not exists points jsonb;
end $$;

commit;

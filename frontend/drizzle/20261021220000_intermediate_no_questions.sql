-- Pre-Intermediate now opens like Pre-Bootcamp: the next Intermediate class's
-- dates, Sign-Up or Defer, then the automatic preferred-name and time zone
-- questions, and only then whatever questions an administrator adds. It starts
-- with none of its own, so a saved Pre-Intermediate form has its questions
-- emptied here (the introduction is kept). Answers already given are kept.
--
-- Safe to run on any database:
--   * fresh/empty      - skipped entirely; db:push creates the schema outright
--   * before this      - a saved Pre-Intermediate form loses its questions
--   * already migrated - a guarded no-op

begin;

do $$
begin
  if to_regclass('public.intake_forms') is null then
    raise notice 'no intake_forms yet - nothing to migrate';
    return;
  end if;

  update intake_forms
  set questions = '[]'::jsonb
  where id = 'intermediate'
    and questions <> '[]'::jsonb;
end $$;

commit;

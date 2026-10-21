-- The dietary checklist is now an automatic question on Pre-Bootcamp and
-- Pre-Intermediate, asked after the preferred name and time zone, so the three
-- dietary questions a saved form carried (the yes/no, the description and the
-- 1-5 scale) are taken out of it. Answers already given are kept; they are
-- stored per response, not on the form, so nothing is lost, but the Dietary
-- needs page now reads the checklist's answers.
--
-- Safe to run on any database:
--   * fresh/empty      - skipped entirely; db:push creates the schema outright
--   * before this      - a saved form loses those three questions
--   * already migrated - a guarded no-op

begin;

do $$
begin
  if to_regclass('public.intake_forms') is null then
    raise notice 'no intake_forms yet - nothing to migrate';
    return;
  end if;

  update intake_forms f
  set questions = coalesce(
    (
      select jsonb_agg(q order by ord)
      from jsonb_array_elements(f.questions) with ordinality as t(q, ord)
      where q ->> 'id' not in ('dietary', 'dietary-needs', 'dietary-critical')
    ),
    '[]'::jsonb
  )
  where exists (
    select 1
    from jsonb_array_elements(f.questions) as q
    where q ->> 'id' in ('dietary', 'dietary-needs', 'dietary-critical')
  );
end $$;

commit;

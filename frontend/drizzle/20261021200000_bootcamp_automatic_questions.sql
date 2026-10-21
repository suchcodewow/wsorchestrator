-- Pre-Bootcamp's preferred-name and time zone questions are now automatic: the
-- form asks everyone them whatever its saved questions are, and the form
-- builder neither shows nor stores them. A Bootcamp form saved while they were
-- ordinary (locked) questions has them taken out here, so what is saved is only
-- the questions an administrator writes. Answers already given are kept under
-- their question ids.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the two questions removed from a saved Bootcamp form
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.intake_forms') is null then
    raise notice 'no intake_forms yet — nothing to migrate';
    return;
  end if;

  update intake_forms
  set questions = coalesce(
    (
      select jsonb_agg(q order by ord)
      from jsonb_array_elements(questions) with ordinality as t(q, ord)
      where q->>'id' not in ('preferred-name', 'timezone')
    ),
    '[]'::jsonb
  )
  where id = 'bootcamp'
    and exists (
      select 1
      from jsonb_array_elements(questions) as t(q)
      where q->>'id' in ('preferred-name', 'timezone')
    );
end $$;

commit;

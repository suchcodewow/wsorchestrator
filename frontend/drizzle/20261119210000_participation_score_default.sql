-- participation_score_default: a participation score is set by hand now, and
-- everyone starts at 3, so a Participation assessment still waiting on
-- Generate for its score gets the default. Scores already saved stay as they are.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * already migrated — no score is blank, so nothing changes

begin;

do $$
begin
  if to_regclass('public.evals_submissions') is null or to_regclass('public.evals_assessments') is null then
    raise notice 'no evals tables yet — nothing to migrate';
    return;
  end if;

  update evals_submissions s
     set average_score = 3
    from evals_assessments a
   where a.id = s.assessment_id
     and a.built_in = 'participation'
     and s.average_score is null;
end $$;

commit;

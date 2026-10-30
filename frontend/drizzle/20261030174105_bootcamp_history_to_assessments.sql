-- bootcamp_history_to_assessments: every class someone attended becomes
-- submissions in a released bootcamp, so assessments are the only record of
-- who attended and how they scored. The employees history columns stay for
-- one release, unread, and are dropped after it.
--
--   * one bootcamp per distinct history day, reused when one already starts
--     that day; a new one is complete, with each stage that has history
--     released. An active bootcamp is never released here.
--   * one submission per exercise score, on the assessment of that stage and
--     name; Score-Exams goes to an inactive "Exams" assessment.
--   * a class with an overall score and no exercise scores becomes one
--     submission on an inactive "Overall (imported)" assessment.
--   * someone with a submission in that bootcamp and stage already gets none.
--   * a class with no score at all is dropped.
--   * EXEMPT_DATE (2000-01-01) becomes a pinned `exempt` track, unless the
--     person's track is already pinned.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * columns dropped  — skipped; there is no history left to convert
--   * already migrated — bootcamps are matched by day and submissions by
--     (bootcamp, assessment, attendee), so nothing is made twice

begin;

do $$
begin
  if to_regclass('public.evals_submissions') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create index if not exists evals_submissions_attendee_email_idx
    on evals_submissions (attendee_email);

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees' and column_name = 'btc_date'
  ) then
    raise notice 'history columns already dropped — nothing to convert';
    return;
  end if;

  -- Each class attended and scored: one row per person and stage, with its
  -- exercise scores. A class with no score at all has nothing to carry over.
  create temporary table history_classes on commit drop as
  select lower(e.email) as email, 'bootcamp'::text as stage, e.btc_date as day,
         e.btc_score as score, coalesce(e.btc_individual_scores, '{}'::jsonb) as exercises,
         e.history_updated_by as owner_id,
         coalesce(e.history_created_at, e.btc_date::timestamptz) as submitted_at
  from employees e
  where e.btc_date is not null and e.btc_date <> date '2000-01-01'
    and (e.btc_score is not null or e.btc_individual_scores <> '{}'::jsonb)
  union all
  select lower(e.email), 'intermediate', e.int_date,
         e.int_score, coalesce(e.int_individual_scores, '{}'::jsonb),
         e.history_updated_by,
         coalesce(e.history_created_at, e.int_date::timestamptz)
  from employees e
  where e.int_date is not null and e.int_date <> date '2000-01-01'
    and (e.int_score is not null or e.int_individual_scores <> '{}'::jsonb);

  -- The assessments that hold what no current assessment does.
  insert into evals_assessments (name, stage, audience, active)
  select n.name, s.stage, 'both', false
  from (values ('Exams'), ('Overall (imported)')) n(name)
  cross join (select distinct stage from history_classes) s
  where not exists (
    select 1 from evals_assessments a where a.stage = s.stage and lower(a.name) = lower(n.name)
  );

  -- A bootcamp for every day that has none.
  insert into bootcamps (start_date, btc_days, int_days, status, btc_released_at, int_released_at)
  select h.day, 4,
         case when bool_or(h.stage = 'intermediate') then 3 end,
         'complete',
         case when bool_or(h.stage = 'bootcamp') then now() end,
         case when bool_or(h.stage = 'intermediate') then now() end
  from history_classes h
  where not exists (select 1 from bootcamps b where b.start_date = h.day)
  group by h.day;

  -- A complete bootcamp that already started that day shows its history once released.
  update bootcamps b
  set btc_released_at = coalesce(b.btc_released_at, now()), updated_at = now()
  where b.status = 'complete'
    and exists (select 1 from history_classes h where h.stage = 'bootcamp' and h.day = b.start_date);
  update bootcamps b
  set int_released_at = coalesce(b.int_released_at, now()),
      int_days = coalesce(b.int_days, 3),
      updated_at = now()
  where b.status = 'complete'
    and exists (select 1 from history_classes h where h.stage = 'intermediate' and h.day = b.start_date);

  -- Each class's bootcamp, the oldest one starting that day, unless that
  -- person already has a submission there for that stage.
  create temporary table history_targets on commit drop as
  select h.*, (
    select b.id from bootcamps b where b.start_date = h.day order by b.created_at, b.id limit 1
  ) as bootcamp_id
  from history_classes h;
  delete from history_targets t
  where exists (
    select 1 from evals_submissions s
    join evals_assessments a on a.id = s.assessment_id
    where s.bootcamp_id = t.bootcamp_id and s.attendee_email = t.email and a.stage = t.stage
  );

  -- One submission per exercise score.
  insert into evals_submissions
    (bootcamp_id, assessment_id, attendee_email, assessment_name, average_score, owner_id, submitted_at, updated_at)
  select t.bootcamp_id, a.id, t.email, a.name, x.value::double precision, t.owner_id, t.submitted_at, t.submitted_at
  from history_targets t
  cross join lateral jsonb_each_text(t.exercises) x(key, value)
  join lateral (
    select a.id, a.name from evals_assessments a
    where a.stage = t.stage and lower(a.name) = lower(regexp_replace(x.key, '^Score-', ''))
    order by a.active desc, a.created_at
    limit 1
  ) a on true
  on conflict do nothing;

  -- An overall score with no exercise scores behind it.
  insert into evals_submissions
    (bootcamp_id, assessment_id, attendee_email, assessment_name, average_score, owner_id, submitted_at, updated_at)
  select t.bootcamp_id, a.id, t.email, a.name, round(t.score::numeric, 1)::double precision,
         t.owner_id, t.submitted_at, t.submitted_at
  from history_targets t
  join evals_assessments a on a.stage = t.stage and a.name = 'Overall (imported)'
  where t.score is not null and t.exercises = '{}'::jsonb
  on conflict do nothing;

  -- A class someone never needs to attend is a pinned exempt track.
  update employees
  set track_pinned = true, track_override = 'exempt', track = case when track is null then null else 'exempt' end
  where (btc_date = date '2000-01-01' or int_date = date '2000-01-01')
    and not track_pinned;
end $$;

commit;

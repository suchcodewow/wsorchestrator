-- Turns workshops_demo (a copy of local workshops) into a demo with nobody real in it.
\set ON_ERROR_STOP 1
select current_database() = 'workshops_demo' as ok \gset
\if :ok
\else
  \echo 'not workshops_demo, stopping'
  \quit
\endif

-- What the demo does not need, and what names or quotes people.
do $$
declare t text;
begin
  foreach t in array array[
    'audit_events','accounts','sessions','api_tokens',
    'slack_channel_members','slack_channels','slack_sync_changes','slack_sync_runs','slack_installation',
    'mentions','hibob_employees','hibob_sync_runs','evals_submission_scores','evals_submissions','evals_transcripts',
    'bootcamp_class_reviews','feedback_channels','mimir_coach_messages','mimir_coach_conversations','mimir_coach_stats',
    'google_connections','zoom_connections','harness_tokens','harness_org_secrets','workshop_accounts','intake_responses',
    'iris_feedback','iris_reminder_messages','iris_reminder_runs','meeting_invites','meeting_sync_changes','meeting_sync_runs',
    'meeting_attendance_marks','schedule_session_comments','guest_speaker_history','daily_survey_assignments',
    'release_notice_messages','participation_mark_events','participation_marks','evals_slack_contacts','scorecard_views',
    'video_feedback','mimir_slide_feedback','google_meetings','iris_participants','iris_attempts','iris_takers',
    'mimir_profiles','mimir_concept_progress','mimir_experience_progress','page_tour_views','workshop_runs','users'
  ] loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format('delete from %I', t);
    end if;
  end loop;
end $$;

-- Everyone left, by email, gets a made-up name and an example.com address.
create temp table people (old text primary key, first text, last text, new text);

do $$
declare r record;
begin
  for r in
    select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.data_type = 'text' and c.column_name like '%email%'
  loop
    execute format(
      'insert into people (old) select distinct lower(%I) from %I where %I like ''%%@%%'' on conflict do nothing',
      r.column_name, r.table_name, r.column_name);
  end loop;
end $$;

with f(n, i) as (select n, row_number() over () from unnest(array[
  'Avery','Blake','Casey','Dana','Elliot','Finley','Gray','Harper','Indigo','Jordan','Kai','Logan','Morgan','Noel',
  'Oakley','Parker','Quinn','Riley','Sage','Taylor','Rowan','Emery','Reese','Skyler','Hayden','Jamie','Kendall',
  'Lane','Marlo','Nico','Peyton','Remy','Sasha','Tatum','Wren','Ari','Bellamy','Cameron','Devon','Ellis']) n),
l(n, i) as (select n, row_number() over () from unnest(array[
  'Abbott','Bennett','Carver','Delgado','Ellison','Fairbanks','Garland','Holloway','Ibarra','Jensen','Kowalski',
  'Lindqvist','Marsh','Navarro','Okafor','Prescott','Quintero','Rasmussen','Sterling','Thornton','Underwood',
  'Valdez','Whitaker','Xu','Yates','Zamora','Ashford','Brennan','Castillo','Donovan','Everett','Fontaine',
  'Gallagher','Hartley','Ingram','Kimura','Lockhart','Mercer','Nakamura','Osei','Pemberton','Ramsey','Sinclair',
  'Takahashi','Vance','Winslow','Andersen','Bishop','Coleman','Dupont']) n),
o as (select old, row_number() over (order by md5(old)) - 1 as k from people)
update people p set first = f.n, last = l.n,
  new = lower(f.n || '.' || l.n || case when o.k >= 2000 then (o.k / 2000)::text else '' end) || '@example.com'
from o, f, l
where p.old = o.old and f.i = (o.k % 40) + 1 and l.i = ((o.k / 40) % 50) + 1;

do $$
declare r record;
begin
  for r in
    select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.data_type = 'text' and c.column_name like '%email%'
  loop
    execute format('update %I x set %I = p.new from people p where lower(x.%I) = p.old',
      r.table_name, r.column_name, r.column_name);
  end loop;
end $$;

update employees e set full_name = p.first || ' ' || p.last, chosen_name = null, slack_user_id = null
from people p where e.email = p.new;
update employees e set reports_to_name = m.full_name from employees m where e.reports_to_email = m.email;
update employees set reports_to_name = null where reports_to_email is null;

update schedule_checklist_items i set owner_name = coalesce((select full_name from employees where email = i.owner_email), '')
  where owner_name is not null and owner_name <> '';
update schedule_checklist_items i set created_by_name = coalesce((select full_name from employees where email = i.created_by_email), '')
  where created_by_name is not null and created_by_name <> '';
update schedule_checklist_items set done_by_name = '' where done_by_name <> '';

-- Nothing left should mention the real domain.
select 'left over harness.io in employees', count(*) from employees where email like '%harness.io';

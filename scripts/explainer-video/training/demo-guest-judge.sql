\set ON_ERROR_STOP 1
select current_database() = 'workshops_demo' as ok \gset
\if :ok
\else
  \echo 'not workshops_demo, stopping'
  \quit
\endif
begin;

select id as active from bootcamps where status = 'active' \gset
select id as donor from bootcamps where status = 'complete' and start_date = '2026-11-17'
  and exists (select 1 from schedule_sessions where bootcamp_id = bootcamps.id and track = 'int') limit 1 \gset

-- The other three tracks, from the completed bootcamp that has them, with their staff.
create temp table copied as
select s.id as old_id, gen_random_uuid() as new_id from schedule_sessions s
join bootcamps a on a.id = :'active'
where s.bootcamp_id = :'donor' and s.track in ('btc_se', 'int', 'int_se')
  and s.day <= case when s.track like 'btc%' then a.btc_days else coalesce(a.int_days, 0) end;

insert into schedule_sessions (id, bootcamp_id, track, day, start_minute, minutes, kind, audience, type_id, name,
  description, emoji, color, room_id, assessment_id, created_by)
select c.new_id, :'active', s.track, s.day, s.start_minute, s.minutes, s.kind, s.audience, s.type_id, s.name,
  s.description, s.emoji, s.color, s.room_id, s.assessment_id, null
from schedule_sessions s join copied c on c.old_id = s.id;

insert into schedule_session_staff (session_id, email, leader, room_id, position)
select c.new_id, st.email, st.leader, st.room_id, st.position
from schedule_session_staff st join copied c on c.old_id = st.session_id;

-- Rowan Mercer, the guest judge the videos follow: an instructor in every Bootcamp breakout,
-- in Breakout 2, and the leader of the objection handling panel.
\set judge 'rowan.mercer@example.com'
\set lead 'blake.abbott@example.com'
select r.id as room from facility_rooms r join bootcamps b on b.facility_id = r.facility_id
  where b.id = :'active' and r.name = 'Breakout 2' \gset

insert into schedule_session_staff (session_id, email, leader, room_id, position)
select s.id, :'lead', true, (select r.id from facility_rooms r join bootcamps b on b.facility_id = r.facility_id
  where b.id = :'active' and r.name = 'Breakout 1'), 0
from schedule_sessions s where s.bootcamp_id = :'active' and s.track = 'btc' and s.kind = 'breakout'
  and not exists (select 1 from schedule_session_staff x where x.session_id = s.id and x.leader)
on conflict do nothing;

update schedule_session_staff st set room_id = (select r.id from facility_rooms r join bootcamps b on b.facility_id = r.facility_id
  where b.id = :'active' and r.name = 'Breakout 1')
from schedule_sessions s where s.id = st.session_id and s.bootcamp_id = :'active' and s.kind = 'breakout' and st.room_id is null;

insert into schedule_session_staff (session_id, email, leader, room_id, position)
select s.id, :'judge', false, :'room', 1
from schedule_sessions s where s.bootcamp_id = :'active' and s.track = 'btc' and s.kind = 'breakout'
on conflict do nothing;

delete from schedule_session_staff st using schedule_sessions s
  where s.id = st.session_id and s.bootcamp_id = :'active' and s.name = 'Objection Handling Panel';
insert into schedule_session_staff (session_id, email, leader, position)
select s.id, :'judge', true, 0 from schedule_sessions s
where s.bootcamp_id = :'active' and s.track = 'btc' and s.name = 'Objection Handling Panel';

-- Each Bootcamp breakout is scored on an assessment.
update schedule_sessions set assessment_id = a.id from evals_assessments a
where schedule_sessions.bootcamp_id = :'active' and schedule_sessions.track = 'btc' and schedule_sessions.kind = 'breakout'
  and a.stage = 'bootcamp' and a.name = case schedule_sessions.name
    when 'Harness PoV Slides Certification' then 'Discovery/OU'
    when 'How We''re Different 101 Certification' then 'SDA Differentiators Whiteboard'
    when 'SDA & STA - How We''re Different 201 - Certification' then 'SDA Differentiators Whiteboard'
    when 'EMD Certification Scenarios' then 'First Call / EMD'
  end;

-- Rowan's group, and Blake's, in every scored breakout: what eVals' "Assigned to me" lists.
insert into schedule_session_groups (session_id, email, instructor_email, position)
select s.id, g.email, g.instructor, g.pos
from schedule_sessions s
cross join (values
  ('cameron.delgado@example.com', :'judge', 0), ('elliot.holloway@example.com', :'judge', 1),
  ('hayden.sterling@example.com', :'judge', 2), ('kendall.valdez@example.com', :'judge', 3),
  ('nico.osei@example.com', :'judge', 4), ('riley.hartley@example.com', :'judge', 5),
  ('ari.fontaine@example.com', :'lead', 0), ('blake.jensen@example.com', :'lead', 1),
  ('finley.everett@example.com', :'lead', 2), ('jamie.brennan@example.com', :'lead', 3),
  ('logan.ibarra@example.com', :'lead', 4), ('peyton.xu@example.com', :'lead', 5)
) as g(email, instructor, pos)
where s.bootcamp_id = :'active' and s.track = 'btc' and s.kind = 'breakout' and s.assessment_id is not null
  and exists (select 1 from schedule_session_staff st where st.session_id = s.id and st.email = g.instructor)
on conflict do nothing;

-- The judge signs in by session token (TESTING.md, "A screenshot of a signed-in page"), as does an
-- administrator for looking around. Neither token is a secret: they open only this local demo.
insert into users (id, name, email) values
  ('demo-judge', 'Rowan Mercer', :'judge'), ('demo-admin', 'Demo Admin', 'demo.admin@example.com')
on conflict do nothing;
update users set is_platform_admin = true where id = 'demo-admin';
insert into sessions ("sessionToken", "userId", expires) values
  ('demo-judge-token', 'demo-judge', now() + interval '1 year'),
  ('demo-admin-token', 'demo-admin', now() + interval '1 year')
on conflict ("sessionToken") do update set expires = excluded.expires;

commit;

select s.track, s.day, count(*) from schedule_sessions s where s.bootcamp_id = :'active' group by 1, 2 order by 1, 2;
select s.day, s.name, st.leader, s.assessment_id is not null as scored from schedule_session_staff st
  join schedule_sessions s on s.id = st.session_id where st.email = :'judge' and s.bootcamp_id = :'active' order by 1;

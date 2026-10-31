-- Who the Google Meetings sync adds to every occurrence stops being whoever
-- holds the Assessments Administrator role and becomes the meeting facilitators,
-- picked on the tab. They start as those people, so the next sync changes no invite.
begin;

insert into evals_settings (key, value)
select
  'meeting_facilitators',
  coalesce(json_agg(json_build_object('email', email, 'fullName', full_name) order by email)::text, '[]')
from (
  select lower(email) as email, coalesce(max(name), '') as full_name
  from users
  where evals_role = 'administrator' and email is not null
  group by lower(email)
  order by lower(email)
  limit 100
) holders
on conflict (key) do nothing;

commit;

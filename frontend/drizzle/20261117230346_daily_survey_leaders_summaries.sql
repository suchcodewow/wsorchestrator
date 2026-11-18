-- daily_surveys.summaries / summarized_at: Claude's summary of each session,
-- from Survey Results' Generate AI Summary button, keyed by session id.
--
-- Also gives the sessions of surveys already sent their leader's name, as
-- assigning now copies it in: from the session's leader on the schedule,
-- named by their account, else the employee list, else their email. A
-- session already carrying a leader, or no longer on the schedule, or with no
-- leader, is left as it is.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — columns added, leaders filled in
--   * already migrated — columns kept; only sessions still lacking a leader are touched

begin;

do $$
begin
  if to_regclass('public.daily_surveys') is null then
    raise notice 'no daily_surveys — nothing to migrate';
    return;
  end if;

  alter table daily_surveys add column if not exists summaries jsonb not null default '{}'::jsonb;
  alter table daily_surveys add column if not exists summarized_at timestamptz;

  update daily_surveys ds
  set sessions = (
    select jsonb_agg(
      case
        when elem ? 'leader' or lead.name is null then elem
        else elem || jsonb_build_object('leader', lead.name)
      end
      order by ord
    )
    from jsonb_array_elements(ds.sessions) with ordinality as e(elem, ord)
    left join lateral (
      select coalesce(
        (select nullif(u.name, '') from users u where lower(u.email) = st.email order by u.id limit 1),
        (select nullif(n.full_name, '') from employees n where n.email = st.email
          order by n.active desc, n.imported_at desc, n.id limit 1),
        st.email
      ) as name
      from schedule_session_staff st
      where st.leader and st.session_id::text = elem->>'id'
      limit 1
    ) lead on true
  )
  where jsonb_array_length(ds.sessions) > 0
    and exists (select 1 from jsonb_array_elements(ds.sessions) x where not x ? 'leader');
end $$;

commit;

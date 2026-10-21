-- `employees` becomes the one list of people, and the tables that only kept a
-- copy of something about them go:
--
--   * bootcamp_history — each person's BTC and INT days and scores move onto
--     their employee row (btc_date … history_updated_at). Someone with a
--     history whom HiBob has never sent gets an inactive row of their own,
--     under the id their history row had, so nobody's history is lost.
--   * slack_users      — the Slack id looked up for an email moves to
--     employees.slack_user_id / slack_looked_up_at.
--   * full_name on evals_slack_contacts, cohort_channel_contacts,
--     bootcamp_judges, schedule_session_staff and schedule_session_groups —
--     the name is read from employees instead.
--   * employee_chosen_names, employee_track_overrides — copied onto employees
--     by 20261021120000 and left for the release it replaced; copied again in
--     case that release wrote to them since, then dropped.
--
-- Dropping bootcamp_history in the same step also keeps the release being
-- replaced from wiping what is folded in here: its HiBob sync reads that table
-- before it rewrites employees, so with it gone the sync fails first.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — columns added, filled, and the old tables dropped
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table employees add column if not exists slack_user_id text;
  alter table employees add column if not exists slack_looked_up_at timestamptz;
  alter table employees add column if not exists btc_date date;
  alter table employees add column if not exists int_date date;
  alter table employees add column if not exists btc_score double precision;
  alter table employees add column if not exists int_score double precision;
  alter table employees add column if not exists btc_individual_scores jsonb;
  alter table employees add column if not exists int_individual_scores jsonb;
  alter table employees add column if not exists history_updated_by text;
  alter table employees add column if not exists history_created_at timestamptz;
  alter table employees add column if not exists history_updated_at timestamptz;

  if not exists (select 1 from pg_constraint where conname = 'employees_btc_score_check') then
    alter table employees add constraint employees_btc_score_check check (btc_score between 1 and 4);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employees_int_score_check') then
    alter table employees add constraint employees_int_score_check check (int_score between 1 and 4);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employees_history_updated_by_users_id_fk') then
    alter table employees add constraint employees_history_updated_by_users_id_fk
      foreign key (history_updated_by) references users(id) on delete set null;
  end if;

  if to_regclass('public.bootcamp_history') is not null then
    -- Onto the one row per email the app reads first: the active one, else the latest.
    update employees e set
        btc_date = h.btc_date,
        int_date = h.int_date,
        btc_score = h.btc_score,
        int_score = h.int_score,
        btc_individual_scores = h.btc_individual_scores,
        int_individual_scores = h.int_individual_scores,
        history_updated_by = h.updated_by,
        history_created_at = h.created_at,
        history_updated_at = h.updated_at
      from bootcamp_history h
      where e.id = (
        select n.id from employees n
        where n.email = lower(h.email)
        order by n.active desc, n.imported_at desc, n.id
        limit 1
      );

    -- Everyone else with a history: an inactive row of their own, named from
    -- their email as the sync would (first.last → First Last).
    insert into employees (
        id, email, full_name, raw, active,
        btc_date, int_date, btc_score, int_score, btc_individual_scores, int_individual_scores,
        history_updated_by, history_created_at, history_updated_at)
      select
        h.id::text,
        lower(h.email),
        coalesce(
          (select case when array_length(p, 1) >= 2 then initcap(p[1]) || ' ' || initcap(p[array_length(p, 1)]) end
             from (select array_remove(array(
                     select regexp_replace(part, '\d+$', '')
                     from unnest(string_to_array(regexp_replace(split_part(lower(h.email), '@', 1), '^c_', ''), '.')) part
                   ), '') p) parts),
          ''),
        '{}'::jsonb,
        false,
        h.btc_date, h.int_date, h.btc_score, h.int_score, h.btc_individual_scores, h.int_individual_scores,
        h.updated_by, h.created_at, h.updated_at
      from bootcamp_history h
      where not exists (select 1 from employees n where n.email = lower(h.email))
      on conflict (id) do nothing;

    drop table bootcamp_history;
  end if;

  if to_regclass('public.slack_users') is not null then
    update employees e set slack_user_id = s.slack_user_id, slack_looked_up_at = s.looked_up_at
      from slack_users s
      where e.email = s.email and e.slack_looked_up_at is null;
    drop table slack_users;
  end if;

  alter table evals_slack_contacts drop column if exists full_name;
  alter table cohort_channel_contacts drop column if exists full_name;
  alter table bootcamp_judges drop column if exists full_name;
  alter table schedule_session_staff drop column if exists full_name;
  alter table schedule_session_groups drop column if exists full_name;

  if to_regclass('public.employee_chosen_names') is not null then
    update employees e set chosen_name = c.full_name
      from employee_chosen_names c
      where lower(e.email) = c.email and e.chosen_name is null;
    drop table employee_chosen_names;
  end if;

  if to_regclass('public.employee_track_overrides') is not null then
    update employees e set track_pinned = true, track_override = o.track
      from employee_track_overrides o
      where lower(e.email) = o.email and not e.track_pinned;
    drop table employee_track_overrides;
  end if;
end $$;

commit;

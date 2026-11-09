-- People a Training administrator adds to the current cohort by hand, from
-- the Cohorts page's Add attendee: one-off attendees the cohort's rules leave
-- out. Each is added to one stage, on the Sales, Engineer or Other track:
-- Other is for an attendee who is neither, such as a CTO joining.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists cohort_additions (
    email text primary key,
    stage text not null,
    track text not null,
    added_by text
      constraint cohort_additions_added_by_users_id_fk references users (id) on delete set null,
    added_at timestamptz not null default now(),
    constraint cohort_additions_stage_check check (stage in ('bootcamp', 'intermediate')),
    constraint cohort_additions_track_check check (track in ('sales', 'engineer', 'other'))
  );
end $$;

commit;

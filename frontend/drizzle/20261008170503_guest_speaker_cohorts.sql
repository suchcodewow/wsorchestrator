-- Cohorts the guest speaker history lists before anyone is down for them,
-- so an upcoming cohort shows on the Logistics page as a space for a Training
-- administrator to fill in. Starts with November 2026, the next one.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table created and November 2026 added
--   * already migrated — the table kept, and November 2026 not added again

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists guest_speaker_cohorts (
    cohort date primary key,
    created_by text
      constraint guest_speaker_cohorts_created_by_users_id_fk references users (id) on delete set null,
    created_at timestamptz not null default now()
  );

  insert into guest_speaker_cohorts (cohort) values ('2026-11-01') on conflict do nothing;
end $$;

commit;

-- Guest speaker history: who taught, commentated or judged which session at
-- a cohort kept outside the Scheduler, entered by a Training administrator on
-- the Logistics page's Guest judges tab. The table starts empty: the cohorts
-- from before the Scheduler are entered there, so no one's name is in the
-- repository.
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

  create table if not exists guest_speaker_history (
    id uuid primary key default gen_random_uuid(),
    cohort date not null,
    program text not null,
    session text not null default '',
    role text not null,
    full_name text not null,
    email text,
    constraint guest_speaker_history_program_check check (program in ('bootcamp', 'intermediate')),
    constraint guest_speaker_history_role_check check (role in ('teach', 'commentator', 'judge', 'speaker'))
  );
  create unique index if not exists guest_speaker_history_entry_idx
    on guest_speaker_history (cohort, program, session, role, full_name);
  create index if not exists guest_speaker_history_email_idx on guest_speaker_history (email);
end $$;

commit;

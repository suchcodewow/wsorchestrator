-- Logistics intake: the form a new bootcamp attendee fills in, and every
-- answer sent to it. Until the form is first saved, the app serves the
-- default in src/lib/logistics/intake.ts, so nothing is seeded here.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the tables created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists intake_forms (
    id text primary key,
    title text not null,
    description text not null default '',
    questions jsonb not null default '[]'::jsonb,
    updated_by text
      constraint intake_forms_updated_by_users_id_fk references users (id) on delete set null,
    updated_at timestamptz not null default now(),
    constraint intake_forms_id_check check (id = 'intake')
  );

  create table if not exists intake_responses (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    answers jsonb not null,
    submitted_at timestamptz not null default now()
  );
  create index if not exists intake_responses_email_idx on intake_responses (email, submitted_at);
end $$;

commit;

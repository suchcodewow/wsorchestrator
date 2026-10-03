-- evals_slack_contacts: the people eVals Settings → Additional Slack Contacts
-- lists, added to the Slack messages sent to each attendee's team at the end
-- of a bootcamp. It replaces the Sheet's "Add these email to any slack" Config
-- column. One row per lowercased email.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists evals_slack_contacts (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    full_name text not null default '',
    created_by text references users (id) on delete set null,
    created_at timestamptz not null default now()
  );

  create unique index if not exists evals_slack_contacts_email_idx on evals_slack_contacts (email);
end $$;

commit;

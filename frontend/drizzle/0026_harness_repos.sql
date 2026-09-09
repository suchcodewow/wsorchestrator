-- The GitHub repositories every workshop imports into Harness Code.
--
-- An administrator lists a repository once in Settings → GitHub Repos, saying
-- what it should be called in Harness and whether it belongs to the event's
-- organization or to each attendee's own project. Provisioning then imports
-- every row: org-scoped rows once, right after the org is made, and
-- project-scoped rows once per attendee, right after their project is made.
--
-- `url` is kept verbatim so the settings page can link back to where the
-- repository came from; `provider_repo` is the `owner/name` the Harness
-- importer actually takes, parsed out of that URL when the row is saved.
--
-- Safe to run on any database:
--   * fresh/empty      — the table is created here, or by db:push
--   * pre-feature      — the table is created
--   * already migrated — a guarded no-op

begin;

create table if not exists harness_repos (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  provider_repo text not null,
  identifier text not null,
  scope text not null,
  added_by text references users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One name per scope. Harness keeps org repos and project repos in separate
-- spaces, so the same name at both levels is legal — two rows for the same name
-- at the *same* level is only ever a mistake.
create unique index if not exists harness_repos_identifier_idx
  on harness_repos (identifier, scope);

commit;

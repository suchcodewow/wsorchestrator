-- Two admin settings tables: org secrets, and Harness template sources.
--
-- `harness_org_secrets` holds constants an administrator wants in every
-- workshop's Harness organization — a licence key, a shared registry password,
-- a partner's service account JSON. Not the same thing as `harness_components`,
-- which describes secrets whose values a *run* provides (a Terraform-minted
-- cloud credential, via a `${...}` binding). These have no run-time input, so
-- they are typed in once and the runner upserts them into each org right after
-- it is created — before the catalog, so a catalog connector may reference one
-- as `org.<identifier>`.
--
-- `harness_template_sources` records an org — optionally narrowed to one
-- project — whose templates this deployment may read, and the token that reads
-- it. Distinct from `harness_tokens`: those are one user's own credential, these
-- are the site's and name a place as well as a credential, which is why the
-- unique key is the triple rather than the token.
--
-- Both store their credential encrypted rather than hashed (AES-256-GCM, key
-- derived from HARNESS_TOKEN_ENC_KEY or AUTH_SECRET) for the reason
-- `0019_harness_tokens.sql` spells out: the value has to come back out intact.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-feature      — both tables and their indexes are created
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'no users table — nothing to attach the admin settings tables to';
    return;
  end if;

  create table if not exists harness_org_secrets (
    id uuid primary key default gen_random_uuid(),
    identifier text not null,
    -- 'text' for an inline value, 'file' for an uploaded one. The two take
    -- different Harness endpoints, which is the only reason it is stored.
    kind text not null,
    file_name text,
    -- Length of the plaintext, so the list needn't decrypt a row to size it.
    bytes integer not null,
    secret bytea not null,
    updated_by text references users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  -- One value per name: the identifier is what Harness is told to call it.
  create unique index if not exists harness_org_secrets_identifier_idx
    on harness_org_secrets (identifier);

  create table if not exists harness_template_sources (
    id uuid primary key default gen_random_uuid(),
    account_id text not null,
    account_name text,
    org_identifier text not null,
    org_name text,
    -- Empty string, not null, for "the whole org" — Postgres treats nulls as
    -- distinct, so a nullable column would let two org-wide rows for the same
    -- token past the unique index below.
    project_identifier text not null default '',
    project_name text,
    tail text not null,
    fingerprint text not null,
    secret bytea not null,
    added_by text references users(id) on delete set null,
    created_at timestamptz not null default now()
  );

  create unique index if not exists harness_template_sources_idx
    on harness_template_sources (fingerprint, org_identifier, project_identifier);
end $$;

commit;

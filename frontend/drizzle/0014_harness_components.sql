-- The Harness component catalog: the secrets, connectors, and (later)
-- templates every workshop org gets, as data rather than as code.
--
-- Until now these were three hand-written function pairs in the runner's
-- Harness client, their identifiers in environment variables, and their
-- ordering given by nothing more than where the calls sat in the provisioning
-- routine. That is fine for three pairs written by one person. It cannot
-- express a template that depends on a connector that depends on a secret, and
-- it cannot accept a component from anyone without commit access.
--
-- As rows they carry their own dependencies, so the runner can topologically
-- sort them instead of relying on source order, and a contributor can add one
-- without touching TypeScript.
--
-- The seed is the three cloud credential pairs exactly as the runner created
-- them before this migration — same identifiers, same names, same payloads — so
-- a workshop provisioned after it is indistinguishable from one provisioned
-- before.
--
-- NOTE for deployments that overrode HARNESS_{GCP,AZURE,AWS}_{SECRET,CONNECTOR}_ID
-- or _NAME: those variables are no longer read. The seed uses the defaults. If
-- yours differed, update the identifier and name on the seeded rows to match
-- what your existing lab content references before provisioning anything new.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-catalog      — tables, indexes, and the seed are created
--   * already migrated — every step is a guarded no-op, and each seed row is
--                        inserted only where that identifier is absent, so
--                        local edits to a seeded component survive a re-run

begin;

do $$
begin
  -- Nothing to add on a brand-new database: `db:push` will create the current
  -- schema, these tables included, directly. The seed below is skipped with it,
  -- which is correct — a fresh database is seeded by `db:seed`, not by a
  -- migration written for databases that predate the table.
  if to_regclass('public.workshop_runs') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists harness_component_sets (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    status text not null default 'testing',
    author_id text references users(id) on delete set null,
    notes text not null default '',
    run_id uuid references workshop_runs(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists harness_component_sets_status_idx
    on harness_component_sets (status, updated_at);

  create table if not exists harness_components (
    id uuid primary key default gen_random_uuid(),
    set_id uuid references harness_component_sets(id) on delete cascade,
    identifier text not null,
    kind text not null,
    scope text not null default 'org',
    name text not null,
    description text not null default '',
    spec jsonb not null,
    requires jsonb not null default '[]'::jsonb,
    depends_on jsonb not null default '[]'::jsonb,
    builtin boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  -- An identifier names one thing in the baseline and one thing within a
  -- candidate set. A candidate may reuse a baseline identifier: that is how it
  -- proposes replacing it.
  create unique index if not exists harness_components_baseline_idx
    on harness_components (identifier) where set_id is null;

  create unique index if not exists harness_components_set_idx
    on harness_components (set_id, identifier) where set_id is not null;

  create index if not exists harness_components_set_list_idx
    on harness_components (set_id, identifier);

  -- The baseline: what the runner used to do in code.
  --
  -- Every identifier is org-local, so every event gets the same names and a
  -- pipeline written against `org.gcp` works in any workshop.
  --
  -- `requires` names the Terraform outputs each one needs. A credential absent
  -- because its cloud was not selected leaves the pair unapplied rather than
  -- failing — but a connector whose *secret* landed and whose own inputs did
  -- not is an error, which is what the runner's "dependencies applied, own
  -- requirements did not" rule reproduces. That was previously an explicit
  -- throw for the Azure client and tenant id, and it still is.
  --
  -- Nothing declares `depends_on`: every one of these references its secret as
  -- `org.<identifier>` inside `spec`, and the runner infers the edge from that.
  -- Declaring it as well would be saying the same thing twice.
  insert into harness_components
    (set_id, identifier, kind, scope, name, description, spec, requires, builtin)
  select v.* from (values
    (
      null::uuid,
      'gcp_service_account',
      -- A file secret, not a text one: a Google Cloud connector reads its
      -- credential from a key file.
      'secret_file',
      'org',
      'GCP Service Account',
      'The workshop service account key, used by the GCP connector.',
      '{"content": "${outputs.harness_gcp_key_json}"}'::jsonb,
      '["outputs.harness_gcp_key_json"]'::jsonb,
      true
    ),
    (
      null::uuid,
      'gcp',
      'connector',
      'org',
      'GCP',
      'Google Cloud connector for the workshop project.',
      '{"type": "Gcp",
        "spec": {"credential": {"type": "ManualConfig",
                                "spec": {"secretKeyRef": "org.gcp_service_account"}}}}'::jsonb,
      '[]'::jsonb,
      true
    ),
    (
      null::uuid,
      'azure_client_secret',
      'secret_text',
      'org',
      'Azure Client Secret',
      'Client secret for the workshop app registration.',
      '{"value": "${outputs.harness_azure_client_secret}"}'::jsonb,
      '["outputs.harness_azure_client_secret"]'::jsonb,
      true
    ),
    (
      null::uuid,
      'azure',
      'connector',
      'org',
      'Azure',
      'Azure connector for the workshop resource group.',
      -- AZURE is the public cloud; the alternative is the US government one,
      -- which nothing here builds in.
      '{"type": "Azure",
        "spec": {"azureEnvironmentType": "AZURE",
                 "credential": {"type": "ManualConfig",
                                "spec": {"applicationId": "${outputs.harness_azure_client_id}",
                                         "tenantId": "${outputs.harness_azure_tenant_id}",
                                         "auth": {"type": "Secret",
                                                  "spec": {"secretRef": "org.azure_client_secret"}}}}}}'::jsonb,
      '["outputs.harness_azure_client_id", "outputs.harness_azure_tenant_id"]'::jsonb,
      true
    ),
    (
      null::uuid,
      'aws_secret_access_key',
      'secret_text',
      'org',
      'AWS Secret Access Key',
      'Secret access key for the workshop IAM user.',
      '{"value": "${outputs.harness_aws_secret_access_key}"}'::jsonb,
      '["outputs.harness_aws_secret_access_key"]'::jsonb,
      true
    ),
    (
      null::uuid,
      'aws',
      'connector',
      'org',
      'AWS',
      'AWS connector for the workshop member account.',
      -- The access key id is sent inline and only the secret is a reference,
      -- which is how Harness models a manual AWS credential: the id is an
      -- identity, the secret is the credential.
      '{"type": "Aws",
        "spec": {"credential": {"type": "ManualConfig",
                                "spec": {"accessKey": "${outputs.harness_aws_access_key_id}",
                                         "secretKeyRef": "org.aws_secret_access_key"}}}}'::jsonb,
      '["outputs.harness_aws_access_key_id"]'::jsonb,
      true
    )
  ) as v(set_id, identifier, kind, scope, name, description, spec, requires, builtin)
  where not exists (
    select 1 from harness_components c
     where c.set_id is null and c.identifier = v.identifier
  );
end $$;

commit;

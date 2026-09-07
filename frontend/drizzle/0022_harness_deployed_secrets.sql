-- The ledger of org secrets a content deploy wrote into somebody else's Harness
-- account, so they can be scrubbed back to a placeholder after a week.
--
-- One row per (account, org, secret). `harness_updated_at` is what Harness said
-- the secret's timestamp was when we wrote it — the guard that stops a scrub
-- overwriting a value the account's owner has since replaced with a real one of
-- their own. `scrub_after` is the deadline, fixed at write time.
--
-- `token_id` is nullable and nulled rather than cascaded when a token is
-- removed: the credential going away does not take the secret out of the
-- customer's account, and the row is the only record that it is there.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-feature      — the table and its indexes are created
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.harness_tokens') is null then
    raise notice 'no harness_tokens table — nothing to record deployed secrets for';
    return;
  end if;

  create table if not exists harness_deployed_secrets (
    id uuid primary key default gen_random_uuid(),
    token_id uuid references harness_tokens (id) on delete set null,
    account_id text not null,
    org_identifier text not null,
    secret_identifier text not null,
    kind text not null,
    harness_updated_at timestamptz,
    written_at timestamptz not null default now(),
    scrub_after timestamptz not null,
    status text not null default 'pending',
    checked_at timestamptz,
    note text
  );

  create unique index if not exists harness_deployed_secrets_idx
    on harness_deployed_secrets (account_id, org_identifier, secret_identifier);

  -- The sweep's query: everything pending and past its deadline.
  create index if not exists harness_deployed_secrets_due_idx
    on harness_deployed_secrets (status, scrub_after);
end $$;

commit;

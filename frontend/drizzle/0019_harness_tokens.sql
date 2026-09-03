-- Saved Harness platform tokens, per user.
--
-- The mirror image of `api_tokens`. Those are credentials this app issues for
-- reaching itself, and only their hashes are stored — a token this app could
-- print back is a token a database read hands over. These are credentials
-- Harness issued, pasted in by their owner, kept so that later work can run
-- against their account with their own permissions instead of the deployment's
-- shared HARNESS_API_KEY.
--
-- That reverses the storage decision: the secret has to come back out, so it is
-- encrypted (AES-256-GCM, key derived from HARNESS_TOKEN_ENC_KEY or AUTH_SECRET)
-- rather than hashed. `secret` is the sealed blob and the only copy; `tail` is
-- the last four characters, which is all the UI ever shows again.
--
-- `account_name`, `principal`, `principal_type` and `permissions` are findings —
-- what Harness answered when the token was last checked — cached so the list
-- renders without a round trip per row. `verified_at` says when that was. There
-- is no label column on purpose: the discovered `account_name` is what names a
-- row, so there is nothing for anyone to type.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-feature      — the table and its indexes are created
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'no users table — nothing to attach harness_tokens to';
    return;
  end if;

  create table if not exists harness_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id text not null references users(id) on delete cascade,
    kind text not null,
    account_id text not null,
    account_name text,
    principal text,
    principal_type text,
    tail text not null,
    fingerprint text not null,
    secret bytea not null,
    permissions jsonb not null default '[]'::jsonb,
    verified_at timestamptz,
    created_at timestamptz not null default now()
  );

  -- Added separately as well as in the create above, so a database that got an
  -- earlier cut of this table still ends up with the column.
  alter table harness_tokens
    add column if not exists principal_type text;

  create index if not exists harness_tokens_user_idx
    on harness_tokens (user_id, created_at);

  -- Scoped to the user, not global: two people may legitimately hold the same
  -- service account token, and refusing the second would leak that the first
  -- exists.
  create unique index if not exists harness_tokens_fingerprint_idx
    on harness_tokens (user_id, fingerprint);
end $$;

commit;

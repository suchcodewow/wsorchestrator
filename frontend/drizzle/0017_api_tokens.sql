-- Personal access tokens, for the contributor bundle's scripts.
--
-- Every other way into this app is a browser session, which a command-line
-- script cannot hold. The bundle is meant to be run from a terminal by somebody
-- iterating with Claude, so it needs a credential that survives being pasted
-- into an environment variable — and one that can be handed out and taken back
-- without touching the account behind it.
--
-- Only the hash is stored. The token is shown once, at creation, and is
-- unrecoverable after: a token this app could print back is a token a database
-- read hands over. `prefix` is the public half, unique so a lookup is one
-- indexed row rather than a scan hashing every live token.
--
-- `expires_at` is not nullable on purpose. A credential handed to somebody
-- outside the team should expire on its own, because the moment nobody
-- remembers issuing it is the moment nobody remembers to revoke it.
--
-- `revoked_at` rather than deleting the row: "this token was revoked" and "this
-- token never existed" are different answers to give someone debugging a
-- script, and only one of them is true.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-tokens       — the table and its indexes are created, empty
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists api_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id text not null references users(id) on delete cascade,
    name text not null,
    prefix text not null unique,
    token_hash text not null,
    expires_at timestamptz not null,
    revoked_at timestamptz,
    last_used_at timestamptz,
    created_at timestamptz not null default now()
  );

  -- The owner's list, newest activity last.
  create index if not exists api_tokens_user_idx
    on api_tokens (user_id, created_at);
end $$;

commit;

-- Where an API token came from.
--
-- The contributor bundle now carries its own token, minted into the download,
-- so nobody has to create one and export it before the scripts will run. That
-- makes two kinds of token, and they are governed differently enough to be
-- worth telling apart:
--
--   * `bundle` — issued into a download. Each download revokes the previous
--     one, so there is at most one live per account, and it does not count
--     against the per-account cap. A stale bundle on an old laptop stops
--     working the next time you download, which is the right default for a
--     credential that ships inside a file.
--
--   * `manual` — asked for on the Contribute page, for a second machine or for
--     CI. Never replaced by anything, and counts against the cap.
--
-- A naming convention would have been free, but it would break the moment
-- somebody named a manual token "bundle", and the revoke-on-download rule is
-- destructive enough that it should not rest on a string comparison.
--
-- Existing rows are `manual`, which is what they are: every token that predates
-- this was created by hand.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-source       — the column is added with its default
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.api_tokens') is null then
    raise notice 'no api_tokens table — nothing to migrate';
    return;
  end if;

  alter table api_tokens
    add column if not exists source text not null default 'manual';

  -- "the live bundle token for this user", which is what a download revokes
  -- before minting its replacement.
  create index if not exists api_tokens_source_idx
    on api_tokens (user_id, source) where revoked_at is null;
end $$;

commit;

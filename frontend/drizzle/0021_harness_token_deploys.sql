-- Where a saved Harness token last deployed content, and when.
--
-- Three columns on `harness_tokens`, all nullable, all null for a token that
-- has never been deployed with. `deployed_org_name` is the name as it was
-- typed, `deployed_org_identifier` is what Harness derived from it, and
-- `deployed_at` is when that deploy finished.
--
-- One slot rather than a history table. The question is "where did this token's
-- content go, and when", asked while looking at the row — and the same record
-- is what prefills the deploy prompt and what lets a second deploy of the same
-- name be read as a retry rather than as a collision with an organization
-- somebody else made.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-feature      — the three columns are added
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.harness_tokens') is null then
    raise notice 'no harness_tokens table — nothing to add deploy columns to';
    return;
  end if;

  alter table harness_tokens
    add column if not exists deployed_org_name text,
    add column if not exists deployed_org_identifier text,
    add column if not exists deployed_at timestamptz;
end $$;

commit;

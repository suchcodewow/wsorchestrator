-- Store each attendee's Azure Temporary Access Pass next to their password.
--
-- Microsoft enforces MFA on Azure portal sign-ins tenant-wide, so an attendee
-- holding only a password cannot get in. A Temporary Access Pass satisfies that
-- with no authenticator app and no enrolment, and the runner issues one per
-- attendee right after the Entra users are created (runner/src/graph.ts). It is
-- returned exactly once, at creation, so it has to be kept — there is no
-- reading it back out of Entra later.
--
-- Two nullable columns: the pass, and when it stops working. Nullable by
-- design — a GCP-only workshop has no Entra account to issue one against, and
-- null is precisely that state, so there is no backfill and no default to pick.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-pass         — the two columns are added, every row null
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  -- Nothing to alter on a brand-new database: `db:push` will create the
  -- current schema, these columns included, directly.
  if to_regclass('public.workshop_accounts') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table workshop_accounts
    add column if not exists azure_access_pass text,
    add column if not exists azure_access_pass_expires_at timestamptz;
end $$;

commit;

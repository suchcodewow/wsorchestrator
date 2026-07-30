-- Let attendees claim their own account on the shared event page.
--
-- Four nullable columns on workshop_accounts: the three answers the attendee
-- types in, plus the timestamp that marks the row as taken. Nullable by
-- design — every existing account row is unclaimed, which is exactly the
-- state a null represents, so there is no backfill and no default to pick.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-claims       — the four columns are added, all rows unclaimed
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
    add column if not exists claimed_name text,
    add column if not exists claimed_from text,
    add column if not exists claimed_vacation text,
    add column if not exists claimed_at timestamptz;
end $$;

commit;

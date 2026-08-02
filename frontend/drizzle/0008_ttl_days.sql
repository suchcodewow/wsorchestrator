-- Move the event lifetime off the 60-minute testing default and onto days.
--
-- `ttl_seconds` used to default to 3600 (one hour) so testing events tore
-- themselves down quickly. Events are now sized in whole days on the create
-- form — one by default, three at most — so the column default becomes one
-- day. New rows always carry an explicit value from the form; this default is
-- the floor for anything inserted without one.
--
-- Only the default changes. Existing rows keep whatever TTL they were created
-- with: a scheduled event booked under the old default is left alone rather
-- than silently having its lifetime stretched out from under whoever booked it.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-days default  — column default swapped to one day
--   * already migrated — the default already matches, so this is a no-op

begin;

do $$
begin
  -- Nothing to alter on a brand-new database: `db:push` will create the
  -- current schema, one-day default included, directly.
  if to_regclass('public.workshop_runs') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table workshop_runs
    alter column ttl_seconds set default 86400;
end $$;

commit;

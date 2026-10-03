-- employees.track gains `exempt`: anyone under the Organization Leader whose
-- bootcamp history dates BTC or INT 2000-01-01, the exempt marker, has that
-- track whatever their title's list. The HiBob sync and every bootcamp history
-- edit set it from then on; this marks the people already stored.
--
-- Safe to run on any database, and again on one restored from a backup:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — exempt members are marked
--   * already migrated — nobody left to mark, so a no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  update employees e
     set track = 'exempt'
    from bootcamp_history h
   where h.email = lower(e.email)
     and e.org_depth is not null
     and (h.btc_date = date '2000-01-01' or h.int_date = date '2000-01-01')
     and e.track is distinct from 'exempt';
end $$;

commit;

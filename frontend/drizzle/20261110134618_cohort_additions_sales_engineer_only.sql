-- cohort_additions: someone added to the current cohort by hand is on Sales
-- or Engineer, as anyone else in it is; the Other track is gone. Each Other
-- addition moves to the track it followed (Sales where none was given), and
-- the employee's track with it, so they are scored, invited and counted as
-- that track straight away.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — Other additions moved, and the track check narrowed
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.cohort_additions') is null then
    raise notice 'no cohort_additions yet — nothing to migrate';
    return;
  end if;

  update employees e
     set track = coalesce(ca.follows, 'sales')
    from cohort_additions ca
   where ca.email = lower(e.email) and ca.track = 'other' and e.track = 'other';

  update cohort_additions
     set track = coalesce(follows, 'sales'), follows = null
   where track = 'other';

  alter table cohort_additions drop constraint if exists cohort_additions_track_check;
  alter table cohort_additions add constraint cohort_additions_track_check check (track in ('sales', 'engineer'));
end
$$;

commit;

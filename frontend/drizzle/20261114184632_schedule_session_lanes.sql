-- Scheduler: sessions side by side. A track-day's sessions each sit in a
-- lane: 0 is the main line, as every session was before; 1 and 2 run beside
-- the sessions they overlap. Sessions of one lane never overlap.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the column and its check added, every session in lane 0
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.schedule_sessions') is null then
    raise notice 'no schedule sessions yet — nothing to migrate';
    return;
  end if;

  alter table schedule_sessions add column if not exists lane integer not null default 0;

  if not exists (select 1 from pg_constraint where conname = 'schedule_sessions_lane_check') then
    alter table schedule_sessions add constraint schedule_sessions_lane_check check (lane between 0 and 2);
  end if;
end $$;

commit;

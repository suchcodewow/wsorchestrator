-- Schedule sessions gain an audience: both, sales or engineers. A session on
-- an SE track that already exists is for engineers; every other is for both.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the column added, SE tracks' sessions set to engineers
--   * already migrated — the column is kept as it is, and the check made again

begin;

do $$
begin
  if to_regclass('public.schedule_sessions') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'schedule_sessions' and column_name = 'audience'
  ) then
    alter table schedule_sessions add column audience text not null default 'both';
    update schedule_sessions set audience = 'engineers' where track in ('btc_se', 'int_se');
  end if;

  alter table schedule_sessions drop constraint if exists schedule_sessions_audience_check;
  alter table schedule_sessions
    add constraint schedule_sessions_audience_check check (audience in ('both', 'sales', 'engineers'));
end $$;

commit;

-- bootcamps.{btc,int}_released_{at,by}: when an Assessments Administrator
-- released a bootcamp's BTC or INT scores to managers on Reporting → Bootcamp.
-- Until then its submissions are seen only by Assessments Viewers and above.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — columns added
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.bootcamps') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table bootcamps
    add column if not exists btc_released_at timestamptz,
    add column if not exists btc_released_by text references users(id) on delete set null,
    add column if not exists int_released_at timestamptz,
    add column if not exists int_released_by text references users(id) on delete set null;
end $$;

commit;

-- bootcamp_history.btc_score and int_score are a class's overall result: a
-- whole number from 1 (poor) to 4 (outstanding), or null for no score yet.
-- The individual exercise scores beside them stay as they are, since an
-- exercise can average to a fraction.
--
-- A row already outside that range stops the migration rather than being
-- changed; fix it by hand and run this again.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — both constraints are added
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'bootcamp_history_btc_score_check') then
    alter table bootcamp_history
      add constraint bootcamp_history_btc_score_check check (btc_score in (1, 2, 3, 4));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'bootcamp_history_int_score_check') then
    alter table bootcamp_history
      add constraint bootcamp_history_int_score_check check (int_score in (1, 2, 3, 4));
  end if;
end $$;

commit;

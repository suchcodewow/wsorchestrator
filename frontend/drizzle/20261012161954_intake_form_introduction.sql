-- An introduction for each intake form, shown above its first question at
-- /intake: Pre-Intermediate's lays out the dates, the all-or-nothing rule and
-- the travel arrangements. A form saved before this keeps its questions and
-- starts with none.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the column added
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.intake_forms') is null then
    raise notice 'no intake_forms yet — nothing to migrate';
    return;
  end if;

  alter table intake_forms add column if not exists introduction text not null default '';
end $$;

commit;

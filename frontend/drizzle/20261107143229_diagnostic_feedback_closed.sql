-- iris_feedback: closed_at and closed_by, set when an Assessments
-- Administrator closes a rating on Diagnostic Settings → Feedback, which
-- hides closed ones unless asked to show them.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — columns added
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.iris_feedback') is null then
    raise notice 'no iris_feedback yet — nothing to migrate';
    return;
  end if;

  alter table iris_feedback add column if not exists closed_at timestamptz;
  alter table iris_feedback add column if not exists closed_by text references users (id) on delete set null;
end
$$;

commit;

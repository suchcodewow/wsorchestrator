-- Add the selected scenarios to workshop_runs.
--
-- Scenarios are optional Terraform layers an organizer checks on for a
-- challenge (see runner/terraform/scenarios/README.md). This column holds the
-- ids they have selected — desired state, which the runner reconciles against
-- what it has actually built and records in `outputs.scenarios_applied`.
--
-- Deliberately a plain text[] rather than a foreign key: the catalog is code
-- that ships in the runner's image, so a run can outlive a scenario, and a run
-- that names one a later build dropped must still be growable and destroyable.
--
-- The default backfills every existing run with the empty array and satisfies
-- the NOT NULL in one step, which is right — no run that predates this had a
-- scenario.
--
-- Safe to run on any database:
--   * fresh/empty     — skipped entirely; db:push creates the schema outright
--   * pre-scenarios   — column added, existing rows default to {}
--   * already migrated — a guarded no-op

begin;

do $$
begin
  -- Nothing to alter on a brand-new database: `db:push` will create the
  -- current schema, this column included, directly.
  if to_regclass('public.workshop_runs') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table workshop_runs
    add column if not exists scenarios text[] not null default '{}';
end $$;

commit;

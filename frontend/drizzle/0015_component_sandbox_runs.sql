-- Sandbox runs, and the contributor role that exists to start them.
--
-- Testing a proposed Harness component means applying it to a real org and
-- exercising it. A full run gets there by building a GCP project and a GKE
-- cluster, which is minutes and real money for something that never touches
-- either — so `harness_only` builds the organization and the component catalog
-- and stops. A component that genuinely needs a cloud credential stays pending,
-- and the run says so, which is a truthful result rather than a silent pass.
--
-- `component_set_id` is what makes a run a test of somebody's proposed
-- components: the runner overlays that candidate set on the published baseline,
-- by identifier, so a candidate can replace a baseline component as well as add
-- beside one.
--
-- `contributor` sits BELOW `operator`, which is the first role inserted rather
-- than appended. That is safe because `roleAtLeast` compares by position in
-- SITE_ROLES and nothing compares against a literal index — but it does mean
-- the enum value has to be added in the right place, hence the BEFORE below.
-- Creating an event is gated on `operator` from here on; it used to be implied
-- by having signed in at all, which would have handed every contributor the
-- ability to build cloud projects.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-sandbox      — the enum value and both columns are added
--   * already migrated — every step is a guarded no-op
--
-- No backfill: `harness_only` defaults false and `component_set_id` null, which
-- is exactly what every existing run is — a normal run deploying the baseline.

begin;

-- Outside the DO block: ALTER TYPE ... ADD VALUE may not be executed from
-- inside a plpgsql body. It is transactional on PG 12+ as long as the new value
-- is not *used* in the same transaction, and nothing here uses it.
do $$
begin
  if to_regclass('public.workshop_runs') is null then
    raise notice 'fresh database — nothing to migrate';
  end if;
end $$;

alter type site_role add value if not exists 'contributor' before 'operator';

do $$
begin
  if to_regclass('public.workshop_runs') is null then
    return;
  end if;

  alter table workshop_runs
    add column if not exists harness_only boolean not null default false;

  alter table workshop_runs
    add column if not exists component_set_id uuid;

  -- Added separately from the column so a database that already has the column
  -- but not the constraint (an earlier partial run) still gets it. Guarded by
  -- name because `add constraint` has no `if not exists`, and skipped entirely
  -- when the catalog tables are not there yet.
  if to_regclass('public.harness_component_sets') is not null
     and not exists (
       select 1 from pg_constraint where conname = 'workshop_runs_component_set_fk'
     )
  then
    alter table workshop_runs
      add constraint workshop_runs_component_set_fk
      foreign key (component_set_id)
      references harness_component_sets(id)
      on delete set null;
  end if;
end $$;

commit;

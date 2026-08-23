-- Templates as a component kind.
--
-- The point of the catalog: a template uses a connector, which uses a secret,
-- and templates use other templates. All of those edges are already inferred
-- from the `org.<identifier>` references the YAML has to contain anyway — a
-- `templateRef: org.deploy_base` is read the same way a connector's
-- `secretKeyRef: org.gcp_service_account` is — so nothing new is needed to
-- order them.
--
-- What is new is `version_label`. A template's identity in Harness is its
-- identifier *and* its version, which is why the runner creates a template
-- rather than upserting one: editing a published template in place would
-- change what a running workshop's pipelines resolve to in the middle of a lab.
-- A change ships as a new label instead.
--
-- Existing rows get '1', which is both the Harness default and what the
-- reference `Add-OrgYaml` has always written. It is meaningless for the other
-- kinds, which ignore it.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-templates    — the column is added with its default
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.harness_components') is null then
    raise notice 'no component catalog — nothing to migrate';
    return;
  end if;

  alter table harness_components
    add column if not exists version_label text not null default '1';
end $$;

commit;

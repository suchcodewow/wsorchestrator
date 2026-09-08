-- Gives org secrets and template sources an owner, so a user may keep their own.
--
-- Both tables were the site's alone: an administrator typed a secret in
-- Settings → Org Secrets, or named a template source in Settings → Templates,
-- and every deploy from every user picked it up. `user_id` adds a second,
-- narrower scope — My settings → My org secrets and My settings → My templates —
-- whose rows only take effect when *that* user deploys, layered over the site's.
-- Null means the site's own, which is what every existing row is.
--
-- The unique indexes have to become one per scope. A single index on
-- (user_id, identifier) would not do: Postgres treats nulls as distinct, so two
-- site-wide rows could share a name — the same reasoning
-- `0020_admin_harness_settings.sql` gives for storing "the whole org" as an
-- empty string rather than null.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-feature      — the column is added and the indexes are re-cut
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.harness_org_secrets') is null then
    raise notice 'no harness_org_secrets table — nothing to scope to a user';
    return;
  end if;

  alter table harness_org_secrets
    add column if not exists user_id text references users(id) on delete cascade;

  -- Was unique across the whole table; now unique only among the site's rows.
  drop index if exists harness_org_secrets_identifier_idx;
  create unique index if not exists harness_org_secrets_identifier_idx
    on harness_org_secrets (identifier)
    where user_id is null;

  create unique index if not exists harness_org_secrets_user_identifier_idx
    on harness_org_secrets (user_id, identifier)
    where user_id is not null;

  alter table harness_template_sources
    add column if not exists user_id text references users(id) on delete cascade;

  drop index if exists harness_template_sources_idx;
  create unique index if not exists harness_template_sources_idx
    on harness_template_sources (fingerprint, org_identifier, project_identifier)
    where user_id is null;

  create unique index if not exists harness_template_sources_user_idx
    on harness_template_sources (user_id, fingerprint, org_identifier, project_identifier)
    where user_id is not null;
end $$;

commit;

-- Which email domains may sign in, moved out of the environment and into a
-- table an administrator edits from the settings page.
--
-- `AUTH_ALLOWED_EMAIL_DOMAINS` still works and is still always in force — it
-- is the bootstrap and the way back in if these rows are ever wrong, the same
-- role `SITE_ADMIN_EMAILS` plays for roles. The two are unioned at sign-in.
--
-- The env var's contents are deliberately *not* copied into the table: it
-- keeps applying on its own, and seeding from it would leave two editable
-- copies of the same rule to disagree with each other.
--
-- An empty table and an empty env var mean no restriction, which is what the
-- site does before anybody configures it.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-settings     — the table and its index are created, empty
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  -- Nothing to add on a brand-new database: `db:push` will create the current
  -- schema, this table included, directly.
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists allowed_email_domains (
    id uuid primary key default gen_random_uuid(),
    domain text not null,
    note text not null default '',
    -- Kept when the administrator who added it is deleted: the rule outlives
    -- the account that wrote it, and losing the row would quietly widen who
    -- can sign in.
    created_by text references users(id) on delete set null,
    created_at timestamptz not null default now()
  );

  -- One row per domain, whatever spelling it was typed in — the application
  -- lowercases and strips the `@` before it writes.
  create unique index if not exists allowed_email_domains_domain_idx
    on allowed_email_domains (domain);
end $$;

commit;

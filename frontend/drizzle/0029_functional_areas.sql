-- Functional areas: the event roles gain "no access", the scheduler gets its
-- own role, and platform administration becomes a flag of its own.
--
-- The site used to have one role per user, `site_role`. It is now the role in
-- the *event* area and keeps its database name; code calls it `eventRole`.
-- Beside it:
--
--   * `site_role` gains `none`, BELOW `contributor`. `roleAtLeast`-style
--     checks compare by position in EVENT_ROLES, so the value has to go in
--     first, hence the BEFORE. Nothing here uses it yet — 0030 makes it the
--     default, in a transaction of its own, because Postgres refuses to use an
--     enum value in the transaction that added it.
--   * `scheduler_role` — `viewer | administrator`, null meaning no access.
--   * `is_platform_admin` — an administrator in every area, and the only one
--     who can grant it. SITE_ADMIN_EMAILS now sets this rather than
--     `site_role`, on their next sign-in.
--
-- No backfill: everyone keeps the event role they have, nobody gains
-- scheduler access, and the bootstrap admins are flagged by the app itself.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-areas        — the enum value, the type and both columns are added
--   * already migrated — every step is a guarded no-op

begin;

-- Outside the DO block: ALTER TYPE ... ADD VALUE may not be executed from
-- inside a plpgsql body. It is transactional on PG 12+ as long as the new value
-- is not *used* in the same transaction, and nothing here uses it.
alter type site_role add value if not exists 'none' before 'contributor';

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table users
    add column if not exists is_platform_admin boolean not null default false;

  -- 0035 renames this type and column to training_role. Once it has, adding
  -- them back here would leave both, and 0035 would then fail to rename.
  if exists (select 1 from pg_type where typname = 'training_role') then
    raise notice 'already renamed to training_role by 0035 — skipped';
    return;
  end if;

  -- `create type` has no `if not exists`, so the guard is explicit.
  if not exists (select 1 from pg_type where typname = 'scheduler_role') then
    create type scheduler_role as enum ('viewer', 'administrator');
  else
    raise notice 'scheduler_role type already exists — skipped';
  end if;

  alter table users
    add column if not exists scheduler_role scheduler_role;
end $$;

commit;

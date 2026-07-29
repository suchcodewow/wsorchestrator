-- Migrate from the workshop-template library to self-describing workshops.
--
-- `drizzle-kit push` cannot perform this change safely: it would drop the
-- `workshops` table (taking each run's ttl_seconds with it) and add NOT NULL
-- columns with no way to populate them. This runs first, then `db:push` sees a
-- schema that already matches and becomes a no-op.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-refactor     — columns added, data backfilled, old model dropped
--   * already migrated — every step is a guarded no-op
--
-- The whole thing is one transaction, so a failure anywhere leaves the
-- database exactly as it was.

begin;

do $$
begin
  -- Nothing to migrate on a brand-new database: `db:push` will create the
  -- current schema directly. Without this, the first deploy would fail here.
  if to_regclass('public.workshop_runs') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  -- -------------------------------------------------------------- --
  -- 1. New columns, nullable for now so existing rows survive.
  -- -------------------------------------------------------------- --

  alter table workshop_runs
    add column if not exists slug          text,
    add column if not exists user_count    integer,
    add column if not exists clouds        text[] not null default '{}',
    add column if not exists org_unit_path text,
    add column if not exists ttl_seconds   integer not null default 3600;

  -- -------------------------------------------------------------- --
  -- 2. Backfill from `workshops` — must happen before it is dropped.
  -- -------------------------------------------------------------- --

  -- Conditional on `workshops` still existing, which is what makes a second
  -- run a no-op: if it is gone the migration has already done this.
  if to_regclass('public.workshops') is not null then

    -- Each run's TTL used to live on its workshop. This is the only step that
    -- reads data we are about to destroy, so it goes first.
    update workshop_runs r
       set ttl_seconds = w.ttl_seconds
      from workshops w
     where w.id = r.workshop_id
       and r.ttl_seconds is distinct from w.ttl_seconds;

    -- `name` was nullable; the new model requires it. Fall back to the
    -- workshop title, then a constant, so no row can block the NOT NULL below.
    update workshop_runs r
       set name = coalesce(r.name, w.title, 'Workshop')
      from workshops w
     where w.id = r.workshop_id
       and r.name is null;

    update workshop_runs
       set name = 'Workshop'
     where name is null;

    -- Mirror of slugify() in src/lib/runs.ts: lowercase, strip accents,
    -- collapse non-alphanumerics to single dashes, trim, cap at 40 chars.
    update workshop_runs
       set slug = coalesce(
         nullif(
           regexp_replace(
             left(
               regexp_replace(
                 regexp_replace(
                   translate(
                     lower(name),
                     'áàâäãåéèêëíìîïóòôöõúùûüñçýÿšžœæ',
                     'aaaaaaeeeeiiiiooooouuuuncyyszoa'
                   ),
                   '[^a-z0-9]+', '-', 'g'
                 ),
                 '^-+|-+$', '', 'g'
               ),
               40
             ),
             '-+$', '', 'g'
           ),
           ''
         ),
         'workshop'
       )
     where slug is null;

    -- Old runs predate attendee accounts, and every template was GCP.
    update workshop_runs set user_count = 1   where user_count is null;
    update workshop_runs set clouds = '{gcp}' where clouds = '{}'::text[];

  else
    raise notice 'workshops table already dropped — backfill skipped';
  end if;

  -- -------------------------------------------------------------- --
  -- 3. Tighten constraints now that every row has a value.
  -- -------------------------------------------------------------- --

  alter table workshop_runs
    alter column name       set not null,
    alter column slug       set not null,
    alter column user_count set not null;

  -- -------------------------------------------------------------- --
  -- 4. Drop the template model.
  -- -------------------------------------------------------------- --

  alter table workshop_runs drop column if exists workshop_id;
  drop table if exists workshops;

  -- -------------------------------------------------------------- --
  -- 5. Attendee accounts.
  --
  -- The foreign key is named explicitly to match Drizzle's convention
  -- (<table>_<column>_<ref-table>_<ref-column>_fk); left to Postgres it would
  -- be `workshop_accounts_run_id_fkey` and every later `db:push` would try to
  -- recreate it.
  -- -------------------------------------------------------------- --

  create table if not exists workshop_accounts (
    id            bigserial primary key,
    run_id        uuid not null,
    email         text not null,
    temp_password text not null,
    created_at    timestamp with time zone not null default now(),
    constraint workshop_accounts_run_id_workshop_runs_id_fk
      foreign key (run_id) references workshop_runs(id) on delete cascade
  );

  create index if not exists workshop_accounts_run_idx
    on workshop_accounts (run_id, id);
end $$;

commit;

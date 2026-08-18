-- Lab guides: the public teaching material, standalone from any scheduled run.
--
-- One new table, `lab_guides`. Nothing else is touched — a guide is not
-- attached to a workshop_run on purpose (a run lives for an hour, the material
-- outlives every room that follows it), so there is no foreign key to add and
-- no existing row to backfill.
--
-- `author_id` is `on delete set null` rather than cascade: deleting the manager
-- who wrote a lab must not delete the lab.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-guides       — the table and its index are created, empty
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

  create table if not exists lab_guides (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,
    title text not null,
    summary text not null default '',
    body text not null default '',
    published boolean not null default false,
    author_id text references users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  -- The index page's query: published guides, most recently updated first.
  --
  -- Guarded on the column still being there. Every file in this directory is
  -- replayed in order on every deploy, and 0009 drops `published` (and this
  -- index) once workshops took over publishing — so on a database already past
  -- 0009 the table exists, the column does not, and an unguarded `create
  -- index` here fails the whole run before the deploy step is reached.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lab_guides'
      and column_name = 'published'
  ) then
    create index if not exists lab_guides_published_idx
      on lab_guides (published, updated_at);
  end if;
end $$;

commit;

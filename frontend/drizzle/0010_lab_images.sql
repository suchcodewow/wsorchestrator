-- Images a lab guide can show, stored as bytes in the database.
--
-- The app runs on Cloud Run, where the container filesystem is per-instance
-- and discarded on the next revision, so an uploaded file written to disk
-- would survive until the next deploy and then quietly stop resolving. The
-- database is the durable store already wired up — and it means an image is
-- covered by the same backups as the guide that references it, so the two are
-- restored together or not at all.
--
-- No foreign key to `lab_guides`. An image is referenced by URL from inside
-- Markdown that any number of guides may hold, and nothing in the bytes says
-- which. This is a library, the same way guides are a library to workshops.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-images       — the table and its index are created, empty
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  -- Nothing to add on a brand-new database: `db:push` will create the current
  -- schema, this table included, directly.
  if to_regclass('public.lab_guides') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists lab_images (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    alt text not null default '',
    mime_type text not null,
    bytes integer not null,
    data bytea not null,
    author_id text references users(id) on delete set null,
    created_at timestamptz not null default now()
  );

  -- The picker's query: newest first, with a name search on top of it.
  create index if not exists lab_images_created_at_idx
    on lab_images (created_at);
end $$;

commit;

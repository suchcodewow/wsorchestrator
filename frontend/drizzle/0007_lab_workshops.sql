-- Workshops: an ordered, reusable collection of lab guides.
--
-- Two new tables. `lab_workshops` is the curriculum — deliberately not named
-- `workshops`, because `workshop_runs` already exists and means an entirely
-- different thing (one provisioned afternoon, reaped an hour later). There is
-- no foreign key between them and they should not read as a pair.
--
-- `lab_workshop_guides` is the ordering, many-to-many so the same guide can
-- open several workshops without being written twice. Both foreign keys
-- cascade: deleting a workshop drops its ordering, and deleting a guide takes
-- it out of every workshop that used it. Neither deletes the other's content.
--
-- Nothing in `lab_guides` changes. A guide belonging to no workshop is still a
-- guide, readable at its own URL.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-workshops    — both tables and their indexes are created, empty
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  -- Nothing to add on a brand-new database: `db:push` will create the current
  -- schema, these tables included, directly.
  if to_regclass('public.lab_guides') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists lab_workshops (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,
    title text not null,
    summary text not null default '',
    published boolean not null default false,
    author_id text references users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists lab_workshops_published_idx
    on lab_workshops (published, updated_at);

  create table if not exists lab_workshop_guides (
    workshop_id uuid not null references lab_workshops(id) on delete cascade,
    guide_id uuid not null references lab_guides(id) on delete cascade,
    position integer not null,
    primary key (workshop_id, guide_id)
  );

  -- Reading a workshop's contents in order.
  create index if not exists lab_workshop_guides_order_idx
    on lab_workshop_guides (workshop_id, position);

  -- The reverse: which workshops use this guide? Asked before deleting one.
  create index if not exists lab_workshop_guides_guide_idx
    on lab_workshop_guides (guide_id);
end $$;

commit;

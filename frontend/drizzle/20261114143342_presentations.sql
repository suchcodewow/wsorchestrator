-- Training → Presentations: a Google Slides deck to present full screen, and
-- each of its slides in deck order, with its speaker notes, a fingerprint of
-- what draws it, and a cached picture of it fetched from Google on first use.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — both tables created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists presentations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    google_file_id text not null,
    google_title text not null default '',
    synced_at timestamptz not null default now(),
    created_by text
      constraint presentations_created_by_users_id_fk references users (id) on delete set null,
    created_at timestamptz not null default now()
  );
  create index if not exists presentations_name_idx on presentations (name);

  create table if not exists presentation_slides (
    id uuid primary key default gen_random_uuid(),
    presentation_id uuid not null
      constraint presentation_slides_presentation_id_presentations_id_fk references presentations (id) on delete cascade,
    google_page_id text not null,
    position integer not null,
    skipped boolean not null default false,
    notes text not null default '',
    fingerprint text not null,
    image bytea,
    image_fingerprint text
  );
  create unique index if not exists presentation_slides_page_idx on presentation_slides (presentation_id, google_page_id);
  create index if not exists presentation_slides_order_idx on presentation_slides (presentation_id, position);
end $$;

commit;

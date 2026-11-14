-- Training → Presentations: converting a Google slide into a page of the
-- presentation's own. The page stands in for the slide (replaces_page_id) and
-- remembers the slide's fingerprint when it was made, so a later change in
-- Google can be flagged; the pictures it draws (the slide's background, and
-- each element cut from Google's drawing of it) are kept as assets.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the columns added and the table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.presentation_pages') is null then
    raise notice 'no presentation pages yet — nothing to migrate';
    return;
  end if;

  alter table presentation_pages add column if not exists replaces_page_id text;
  alter table presentation_pages add column if not exists source_fingerprint text;

  create table if not exists presentation_assets (
    id uuid primary key default gen_random_uuid(),
    presentation_id uuid not null
      constraint presentation_assets_presentation_id_presentations_id_fk references presentations (id) on delete cascade,
    image bytea not null,
    width integer not null,
    height integer not null,
    created_at timestamptz not null default now()
  );
  create index if not exists presentation_assets_presentation_idx on presentation_assets (presentation_id);
end $$;

commit;

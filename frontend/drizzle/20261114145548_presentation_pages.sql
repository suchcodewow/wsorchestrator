-- Training → Presentations: a presentation's own pages, shown among its
-- Google deck's slides without being part of the deck. Each is put before a
-- slide by that slide's Google page id (null: last), and holds its drawing as
-- a JSON document of shapes, text and the reveals that uncover them.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.presentations') is null then
    raise notice 'no presentations yet — nothing to migrate';
    return;
  end if;

  create table if not exists presentation_pages (
    id uuid primary key default gen_random_uuid(),
    presentation_id uuid not null
      constraint presentation_pages_presentation_id_presentations_id_fk references presentations (id) on delete cascade,
    before_page_id text,
    position integer not null,
    document jsonb not null,
    notes text not null default '',
    updated_by text
      constraint presentation_pages_updated_by_users_id_fk references users (id) on delete set null,
    updated_at timestamptz not null default now()
  );
  create index if not exists presentation_pages_order_idx on presentation_pages (presentation_id, position);
end $$;

commit;

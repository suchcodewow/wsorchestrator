-- Drop `published` from lab guides. Publishing is a workshop decision now.
--
-- A guide used to carry its own draft/published flag, from back when a guide
-- was a destination in its own right. Workshops now house the guides, and a
-- workshop is what gets handed to a room — so the flag was being asked to
-- answer a question nobody puts to a single lab any more, while quietly
-- hiding guides out of the middle of workshops that were themselves published.
--
-- After this a guide is simply readable: `/labs/guides/<slug>` always answers,
-- and `lab_workshops.published` is the only thing that gates anything. The
-- index goes with the column; the library's ordering (`order by updated_at
-- desc`) gets one of its own rather than riding on the flag's.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-drop         — the index and column go, the new index is created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  -- Nothing to drop on a brand-new database: `db:push` will create the current
  -- schema, already without the column, directly.
  if to_regclass('public.lab_guides') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  -- Ordering for the guide library, which no longer has a flag to lead with.
  create index if not exists lab_guides_updated_at_idx
    on lab_guides (updated_at);

  drop index if exists lab_guides_published_idx;

  alter table lab_guides
    drop column if exists published;
end $$;

commit;

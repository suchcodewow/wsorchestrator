-- mimir map versions: the concept map is no longer one row rewritten whole.
-- Its structure is kept as versions, the highest of them live, and each
-- concept's videos are rows of their own, one per language, which is all
-- Mimir Studio writes. The live map's videos are copied out of `mimir_map`
-- and its structure becomes version 1. `mimir_map` itself is left in place,
-- unread, for a revision still serving during the deploy.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — tables created; the live map, if any, copied in
--   * already migrated — nothing changes: the copy runs only while there are
--                        no versions, and videos already copied are kept

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists mimir_map_versions (
    version integer primary key,
    content jsonb not null,
    source text not null,
    summary text not null default '',
    created_by text
      constraint mimir_map_versions_created_by_users_id_fk references users (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint mimir_map_versions_source_check check (source in ('import', 'deck', 'edit', 'restore', 'migration')),
    constraint mimir_map_versions_version_check check (version > 0)
  );

  create table if not exists mimir_concept_videos (
    concept_id text not null,
    language text not null,
    object text not null,
    seconds double precision not null,
    transcript text not null,
    created_at timestamptz not null default now(),
    constraint mimir_concept_videos_concept_id_language_pk primary key (concept_id, language),
    constraint mimir_concept_videos_language_check check (language in ('en', 'es'))
  );

  if to_regclass('public.mimir_map') is not null then
    insert into mimir_concept_videos (concept_id, language, object, seconds, transcript)
    select c->>'id', 'en', c#>>'{video,object}', (c#>>'{video,seconds}')::double precision, c#>>'{video,transcript}'
      from mimir_map m, jsonb_array_elements(m.content->'concepts') as e(c)
     where m.id = 'current' and jsonb_typeof(c->'video') = 'object'
    on conflict do nothing;

    insert into mimir_concept_videos (concept_id, language, object, seconds, transcript)
    select c->>'id', t.language, t.file->>'object', (t.file->>'seconds')::double precision, t.file->>'transcript'
      from mimir_map m, jsonb_array_elements(m.content->'concepts') as e(c),
           jsonb_each(coalesce(c#>'{video,translations}', '{}'::jsonb)) as t(language, file)
     where m.id = 'current' and jsonb_typeof(c->'video') = 'object' and t.language = 'es'
    on conflict do nothing;

    insert into mimir_map_versions (version, content, source, summary, created_by, created_at)
    select 1,
           jsonb_set(m.content, '{concepts}',
             (select jsonb_agg(c - 'video' order by n) from jsonb_array_elements(m.content->'concepts') with ordinality as e(c, n))),
           'migration', 'The map as it was before versions.', m.imported_by, m.imported_at
      from mimir_map m
     where m.id = 'current' and not exists (select 1 from mimir_map_versions);
  end if;
end $$;

commit;

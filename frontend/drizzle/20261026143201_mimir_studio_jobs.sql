-- mimir_studio_jobs: Mimir Studio's work — a new slide deck turned into a
-- draft concept map, or one concept's video made again — each run by the
-- mimir-studio Cloud Run job, which reports back by updating its row.
-- video_feedback.status gains 'applied': a comment a regenerated video has
-- taken into account.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table, its indexes and the wider check are made
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists mimir_studio_jobs (
    id uuid primary key default gen_random_uuid(),
    kind text not null,
    status text not null,
    concept_id text,
    label text not null default '',
    input jsonb not null default '{}'::jsonb,
    result jsonb,
    progress text,
    error text,
    execution text,
    requested_by text
      constraint mimir_studio_jobs_requested_by_users_id_fk references users (id) on delete set null,
    created_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint mimir_studio_jobs_kind_check check (kind in ('deck', 'video')),
    constraint mimir_studio_jobs_status_check
      check (status in ('uploading', 'queued', 'running', 'ready', 'succeeded', 'failed', 'published', 'discarded')),
    constraint mimir_studio_jobs_concept_check check ((kind = 'deck') = (concept_id is null))
  );

  create index if not exists mimir_studio_jobs_created_at_idx on mimir_studio_jobs (created_at);
  create index if not exists mimir_studio_jobs_concept_id_idx on mimir_studio_jobs (concept_id);
  create unique index if not exists mimir_studio_jobs_one_deck_idx on mimir_studio_jobs (kind)
    where kind = 'deck' and status in ('uploading', 'queued', 'running');
  create unique index if not exists mimir_studio_jobs_one_video_idx on mimir_studio_jobs (concept_id)
    where kind = 'video' and status in ('uploading', 'queued', 'running');

  if to_regclass('public.video_feedback') is not null then
    alter table video_feedback drop constraint if exists video_feedback_status_check;
    alter table video_feedback
      add constraint video_feedback_status_check check (status in ('pending', 'accepted', 'ignored', 'applied'));
  end if;
end $$;

commit;

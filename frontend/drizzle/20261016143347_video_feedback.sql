-- video_feedback: a thumbs up or thumbs down on a video, from the buttons over
-- every player — a Mimir concept's video, or a stream of a recorded take —
-- with who gave it, where in the video they were, and the comment they wrote
-- if they used the comment button beside the thumb.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — table and indexes created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists video_feedback (
    id uuid primary key default gen_random_uuid(),
    user_id text
      constraint video_feedback_user_id_users_id_fk references users (id) on delete set null,
    video_kind text not null,
    concept_id text,
    recording_track_id uuid
      constraint video_feedback_recording_track_id_recording_tracks_id_fk references recording_tracks (id) on delete cascade,
    video_label text not null default '',
    rating text not null,
    position_seconds double precision not null,
    comment text,
    created_at timestamptz not null default now(),
    constraint video_feedback_video_kind_check check (video_kind in ('mimir_concept', 'recording')),
    constraint video_feedback_rating_check check (rating in ('up', 'down')),
    constraint video_feedback_video_check check (
      (video_kind = 'mimir_concept' and concept_id is not null)
      or (video_kind = 'recording' and recording_track_id is not null)
    )
  );

  create index if not exists video_feedback_created_at_idx on video_feedback (created_at);
  create index if not exists video_feedback_concept_id_idx on video_feedback (concept_id);
  create index if not exists video_feedback_recording_track_id_idx on video_feedback (recording_track_id);
end $$;

commit;

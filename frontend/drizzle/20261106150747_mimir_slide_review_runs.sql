-- The slide review no longer stops at ten slides: each slide is made from a
-- seed, so it is kept as a log of the slides someone finished, and its
-- feedback beside it.
--
-- mimir_slide_review_runs: one row per finished slide, with its seed (which
-- rebuilds the slide), its theme, and the score.
-- mimir_slide_feedback: smiley and confused ratings on a slide, with any
-- comment, for Coach Canary Settings → Coach Canary Feedback.
-- mimir_experience_progress: keeps the Developer and Enterprise Security Team
-- experiences only, so its per-slide part column goes, along with any rows
-- kept for the old fixed slides.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — tables created, slide rows deleted, part dropped
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists mimir_slide_review_runs (
    id uuid primary key default gen_random_uuid(),
    user_id text not null references users (id) on delete cascade,
    seed integer not null,
    theme text not null,
    found integer not null,
    total integer not null,
    wrong_clicks integer not null,
    score integer not null,
    created_at timestamptz not null default now()
  );
  create index if not exists mimir_slide_review_runs_user_idx on mimir_slide_review_runs (user_id, created_at);

  create table if not exists mimir_slide_feedback (
    id uuid primary key default gen_random_uuid(),
    user_id text references users (id) on delete set null,
    seed integer not null,
    theme text not null,
    rating text not null,
    comment text,
    created_at timestamptz not null default now(),
    constraint mimir_slide_feedback_rating_check check (rating in ('up', 'down'))
  );
  create index if not exists mimir_slide_feedback_created_at_idx on mimir_slide_feedback (created_at);

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'mimir_experience_progress' and column_name = 'part'
  ) then
    delete from mimir_experience_progress where experience = 'slide-review';
    alter table mimir_experience_progress drop constraint if exists mimir_experience_progress_user_id_experience_part_pk;
    alter table mimir_experience_progress drop column part;
    alter table mimir_experience_progress
      add constraint mimir_experience_progress_user_id_experience_pk primary key (user_id, experience);
    alter table mimir_experience_progress drop constraint if exists mimir_experience_progress_experience_check;
    alter table mimir_experience_progress
      add constraint mimir_experience_progress_experience_check check (experience in ('developer', 'security'));
  end if;
end
$$;

commit;

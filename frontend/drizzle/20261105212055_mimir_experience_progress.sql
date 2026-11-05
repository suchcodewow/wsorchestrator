-- mimir_experience_progress: each person's finished runs of Coach Canary's
-- hands-on experiences, for Coach Canary Settings → Reporting. The slide
-- review keeps a row per slide (part is the slide's id); the others one row
-- with an empty part. attempts counts finished runs and best_score keeps the
-- highest; the Developer experience has no score.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — table created
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists mimir_experience_progress (
    user_id text not null references users (id) on delete cascade,
    experience text not null,
    part text not null default '',
    attempts integer not null default 0,
    best_score integer,
    first_completed_at timestamptz not null default now(),
    last_completed_at timestamptz not null default now(),
    constraint mimir_experience_progress_user_id_experience_part_pk primary key (user_id, experience, part),
    constraint mimir_experience_progress_experience_check check (experience in ('developer', 'security', 'slide-review'))
  );
end
$$;

commit;

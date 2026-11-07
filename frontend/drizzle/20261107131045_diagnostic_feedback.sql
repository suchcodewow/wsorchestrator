-- iris_feedback: smiley and confused ratings given while taking a Diagnostic
-- test, with any comment, each kept with the question that was on screen,
-- for Diagnostic Settings → Feedback.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — table and indexes created
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists iris_feedback (
    id uuid primary key default gen_random_uuid(),
    user_id text references users (id) on delete set null,
    attempt_id uuid references iris_attempts (id) on delete set null,
    subject text not null,
    mode text not null,
    number integer not null,
    item_id text not null,
    item_version text not null,
    stem text not null,
    rating text not null,
    comment text,
    created_at timestamptz not null default now(),
    constraint iris_feedback_rating_check check (rating in ('up', 'down')),
    constraint iris_feedback_mode_check check (mode in ('live', 'preview'))
  );
  create index if not exists iris_feedback_created_at_idx on iris_feedback (created_at);
  create index if not exists iris_feedback_item_idx on iris_feedback (item_id);
end
$$;

commit;

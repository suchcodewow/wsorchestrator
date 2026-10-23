-- video_feedback.status: what an Assessments Administrator has decided about a
-- comment on Mimir Settings → Mimir Feedback — still waiting ('pending'),
-- 'accepted' (it should change the video) or 'ignored'.
--
-- Safe to run on any database:
--   * no table yet     — skipped
--   * before this      — the column and its check are added
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.video_feedback') is null then
    raise notice 'no video_feedback yet — nothing to migrate';
    return;
  end if;

  alter table video_feedback add column if not exists status text not null default 'pending';

  if not exists (select 1 from pg_constraint where conname = 'video_feedback_status_check') then
    alter table video_feedback
      add constraint video_feedback_status_check check (status in ('pending', 'accepted', 'ignored'));
  end if;
end $$;

commit;

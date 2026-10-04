-- One table for every "@" tag. schedule_comment_mentions becomes `mentions`,
-- and a row now points at exactly one of: a session comment, a checklist
-- item, or the comment on one criterion of an eVals submission. The last is
-- kept by submission and criterion, not by score row, because a revision
-- replaces the scores. Each row also keeps its bootcamp and who tagged whom
-- when, since an eVals comment is revised in place by whoever saves it.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table renamed, widened and backfilled
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  if to_regclass('public.mentions') is null and to_regclass('public.schedule_comment_mentions') is not null then
    alter table schedule_comment_mentions rename to mentions;
    alter index if exists schedule_comment_mentions_pkey rename to mentions_pkey;
    alter index if exists schedule_comment_mentions_comment_email_idx rename to mentions_comment_email_idx;
    alter index if exists schedule_comment_mentions_email_idx rename to mentions_email_idx;
  end if;
  if exists (
    select 1 from pg_constraint
     where conname = 'schedule_comment_mentions_comment_id_fkey' and conrelid = to_regclass('public.mentions')
  ) then
    alter table mentions rename constraint schedule_comment_mentions_comment_id_fkey to mentions_comment_id_fkey;
  end if;

  create table if not exists mentions (
    id uuid primary key default gen_random_uuid(),
    comment_id uuid references schedule_session_comments (id) on delete cascade,
    email text not null,
    full_name text not null default ''
  );

  alter table mentions alter column comment_id drop not null;
  alter table mentions add column if not exists checklist_item_id uuid references schedule_checklist_items (id) on delete cascade;
  alter table mentions add column if not exists submission_id uuid references evals_submissions (id) on delete cascade;
  alter table mentions add column if not exists criterion_id uuid references evals_assessment_criteria (id) on delete cascade;
  alter table mentions add column if not exists bootcamp_id uuid references bootcamps (id) on delete cascade;
  alter table mentions add column if not exists tagged_by text references users (id) on delete set null;
  alter table mentions add column if not exists tagged_by_name text not null default '';
  alter table mentions add column if not exists tagged_by_email text not null default '';
  alter table mentions add column if not exists created_at timestamptz not null default now();

  -- A session comment's tags were made by its author, when it was written.
  update mentions m
     set bootcamp_id = s.bootcamp_id,
         tagged_by = c.author_id,
         tagged_by_name = c.author_name,
         tagged_by_email = c.author_email,
         created_at = c.created_at
    from schedule_session_comments c
    join schedule_sessions s on s.id = c.session_id
   where m.comment_id = c.id and m.bootcamp_id is null;

  -- A database pushed at this schema and then migrated from the start (as an
  -- import's test does) has both tables: 0052 made the old one beside the new.
  if to_regclass('public.schedule_comment_mentions') is not null then
    insert into mentions (id, comment_id, email, full_name, bootcamp_id, tagged_by, tagged_by_name, tagged_by_email, created_at)
    select o.id, o.comment_id, o.email, o.full_name, s.bootcamp_id, c.author_id, c.author_name, c.author_email, c.created_at
      from schedule_comment_mentions o
      join schedule_session_comments c on c.id = o.comment_id
      join schedule_sessions s on s.id = c.session_id
    on conflict do nothing;
    drop table schedule_comment_mentions;
  end if;

  alter table mentions alter column bootcamp_id set not null;

  if not exists (select 1 from pg_constraint where conname = 'mentions_one_source_check') then
    alter table mentions add constraint mentions_one_source_check check (
      num_nonnulls(comment_id, checklist_item_id, submission_id) = 1
      and (submission_id is null) = (criterion_id is null)
    );
  end if;

  create unique index if not exists mentions_comment_email_idx on mentions (comment_id, email);
  create unique index if not exists mentions_checklist_item_email_idx on mentions (checklist_item_id, email);
  create unique index if not exists mentions_score_email_idx on mentions (submission_id, criterion_id, email);
  create index if not exists mentions_email_idx on mentions (email);
end $$;

commit;

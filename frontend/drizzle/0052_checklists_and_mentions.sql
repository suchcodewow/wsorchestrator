-- Day checklists and "@" tags: each day of a bootcamp's two classes keeps a
-- list of what is to be done before it starts, and a session comment keeps
-- whom it tags. Both name people by email, as a session's staff do.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — both tables created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists schedule_comment_mentions (
    id uuid primary key default gen_random_uuid(),
    comment_id uuid not null references schedule_session_comments (id) on delete cascade,
    email text not null,
    full_name text not null default ''
  );
  create unique index if not exists schedule_comment_mentions_comment_email_idx on schedule_comment_mentions (comment_id, email);
  create index if not exists schedule_comment_mentions_email_idx on schedule_comment_mentions (email);

  create table if not exists schedule_checklist_items (
    id uuid primary key default gen_random_uuid(),
    bootcamp_id uuid not null references bootcamps (id) on delete cascade,
    track text not null,
    day integer not null,
    name text not null,
    owner_email text,
    owner_name text not null default '',
    done_at timestamptz,
    done_by text references users (id) on delete set null,
    done_by_name text not null default '',
    created_by text references users (id) on delete set null,
    created_by_name text not null default '',
    created_by_email text not null default '',
    created_at timestamptz not null default now(),
    constraint schedule_checklist_items_track_check check (track in ('btc', 'int')),
    constraint schedule_checklist_items_day_check check (day between 1 and 30)
  );
  create index if not exists schedule_checklist_items_day_idx on schedule_checklist_items (bootcamp_id, track, day, created_at);
  create index if not exists schedule_checklist_items_owner_idx on schedule_checklist_items (owner_email);
end $$;

commit;

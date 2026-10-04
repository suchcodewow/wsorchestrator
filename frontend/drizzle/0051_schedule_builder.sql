-- The schedule builder: facilities and their rooms, session types, and each
-- bootcamp's sessions across its four tracks, with who runs them, which rooms
-- they use and comments on them. Bootcamps gain the facility they are held at.
-- The session types start as the six the Google Sheet used.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — tables created, the types seeded
--   * already migrated — every step is a guarded no-op, and the types are
--                        seeded only into an empty table

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists facilities (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_by text references users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index if not exists facilities_name_idx on facilities (lower(name));

  create table if not exists facility_rooms (
    id uuid primary key default gen_random_uuid(),
    facility_id uuid not null references facilities (id) on delete cascade,
    name text not null,
    capacity integer not null,
    position integer not null default 0,
    created_at timestamptz not null default now(),
    constraint facility_rooms_capacity_check check (capacity between 1 and 10000)
  );
  create unique index if not exists facility_rooms_name_idx on facility_rooms (facility_id, name);
  create index if not exists facility_rooms_facility_idx on facility_rooms (facility_id, position);

  alter table bootcamps add column if not exists facility_id uuid references facilities (id) on delete set null;

  create table if not exists session_types (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    kind text not null,
    emoji text not null default '',
    color text not null default 'slate',
    minutes integer not null default 60,
    description text not null default '',
    position integer not null default 0,
    created_by text references users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint session_types_kind_check check (kind in ('main', 'breakout', 'unstructured')),
    constraint session_types_minutes_check check (minutes between 15 and 600 and minutes % 15 = 0)
  );
  create unique index if not exists session_types_name_idx on session_types (lower(name));

  create table if not exists schedule_sessions (
    id uuid primary key default gen_random_uuid(),
    bootcamp_id uuid not null references bootcamps (id) on delete cascade,
    track text not null,
    day integer not null,
    position integer not null,
    minutes integer not null,
    kind text not null,
    type_id uuid references session_types (id) on delete set null,
    name text not null,
    description text not null default '',
    emoji text not null default '',
    color text not null default 'slate',
    room_id uuid references facility_rooms (id) on delete set null,
    created_by text references users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint schedule_sessions_track_check check (track in ('btc', 'int', 'btc_se', 'int_se')),
    constraint schedule_sessions_kind_check check (kind in ('main', 'breakout', 'unstructured')),
    constraint schedule_sessions_day_check check (day between 1 and 30),
    constraint schedule_sessions_minutes_check check (minutes between 15 and 600 and minutes % 15 = 0)
  );
  create index if not exists schedule_sessions_day_idx on schedule_sessions (bootcamp_id, track, day, position);

  create table if not exists schedule_session_staff (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references schedule_sessions (id) on delete cascade,
    email text not null,
    full_name text not null default '',
    leader boolean not null default false,
    room_id uuid references facility_rooms (id) on delete set null,
    position integer not null default 0
  );
  create unique index if not exists schedule_session_staff_email_idx on schedule_session_staff (session_id, email);
  create unique index if not exists schedule_session_staff_leader_idx on schedule_session_staff (session_id) where leader;

  create table if not exists schedule_session_comments (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references schedule_sessions (id) on delete cascade,
    body text not null,
    author_id text references users (id) on delete set null,
    author_name text not null default '',
    author_email text not null default '',
    created_at timestamptz not null default now()
  );
  create index if not exists schedule_session_comments_session_idx on schedule_session_comments (session_id, created_at);

  if not exists (select 1 from session_types) then
    insert into session_types (name, kind, emoji, color, minutes, position) values
      ('Teach', 'main', '🧑‍🏫', 'blue', 60, 0),
      ('Exam', 'main', '📝', 'amber', 30, 1),
      ('Roleplay', 'breakout', '🎭', 'violet', 90, 2),
      ('Break', 'unstructured', '🕰️', 'slate', 15, 3),
      ('Lunch', 'unstructured', '🍔', 'green', 60, 4),
      ('Unscheduled', 'unstructured', '⏳', 'slate', 15, 5);
  end if;
end $$;

commit;

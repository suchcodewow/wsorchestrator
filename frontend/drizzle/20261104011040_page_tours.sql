-- page_tours, page_tour_steps, page_tour_views: a walk-through of one kind of
-- page — highlight boxes shown in order, each pointing at an element — and
-- which version of it each person has seen, so a new one plays again.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — tables created
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists page_tours (
    id uuid primary key default gen_random_uuid(),
    path_pattern text not null,
    path_regex text not null,
    specificity integer not null,
    version integer not null default 1,
    updated_by text references users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index if not exists page_tours_path_pattern_idx on page_tours (path_pattern);

  create table if not exists page_tour_steps (
    id uuid primary key default gen_random_uuid(),
    tour_id uuid not null references page_tours (id) on delete cascade,
    position integer not null,
    title text not null default '',
    body text not null default '',
    placement text not null default 'auto',
    target jsonb not null,
    constraint page_tour_steps_placement_check check (placement in ('auto', 'top', 'bottom', 'left', 'right'))
  );
  create unique index if not exists page_tour_steps_position_idx on page_tour_steps (tour_id, position);

  create table if not exists page_tour_views (
    user_id text not null references users (id) on delete cascade,
    tour_id uuid not null references page_tours (id) on delete cascade,
    seen_version integer not null,
    seen_at timestamptz not null default now(),
    primary key (user_id, tour_id)
  );
  create index if not exists page_tour_views_tour_id_idx on page_tour_views (tour_id);
end
$$;

commit;

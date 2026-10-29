-- allowed_frame_domains: the sites allowed to show the app in a frame, such as
-- a Mindtickle course. The proxy sends them as the `frame-ancestors` of every
-- page's Content-Security-Policy, after 'self'; with no rows, only the app's
-- own pages may frame it.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table and its index are created, empty
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists allowed_frame_domains (
    id uuid primary key default gen_random_uuid(),
    domain text not null,
    note text not null default '',
    created_by text references users(id) on delete set null,
    created_at timestamptz not null default now()
  );

  create unique index if not exists allowed_frame_domains_domain_idx
    on allowed_frame_domains (domain);
end $$;

commit;

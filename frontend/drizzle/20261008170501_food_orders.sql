-- Logistics food orders: who each is from, when it arrives, what the
-- training team needs from it, and the vendor's PDF.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the table created
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists food_orders (
    id uuid primary key default gen_random_uuid(),
    vendor text not null,
    arrives_at timestamptz not null,
    needs text not null default '',
    file_name text,
    file_bytes integer,
    file_data bytea,
    created_by text
      constraint food_orders_created_by_users_id_fk references users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists food_orders_arrives_at_idx on food_orders (arrives_at);
end $$;

commit;

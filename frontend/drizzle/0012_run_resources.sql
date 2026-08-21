-- What a run has actually built, recorded item by item as the runner confirms
-- each one.
--
-- The run detail page had two ways to answer "what exists so far?" and neither
-- worked while a build was in flight: the log is a provider-speak transcript
-- that scrolls the answer away, and `outputs` is only written when the whole
-- run goes ready. So the page filled the gap with the one growing list it did
-- have — a row per attendee account, credentials and all — which pushed
-- everything else off the screen on a fifty-person workshop.
--
-- Rows are upserted on (run_id, kind, key): a retried or grown run updates what
-- it recorded rather than listing it twice, and the things created one at a
-- time (accounts, Harness projects) count up in `done`/`total` in place instead
-- of adding a row per attendee. The reaper deletes them on teardown — this
-- table describes what is standing, so it must not outlive the resources.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-resources    — the table and its indexes are created, empty
--   * already migrated — every step is a guarded no-op
--
-- No backfill: the rows are written by the runner as it builds, and a run that
-- was provisioned before this shipped has nothing to reconstruct them from.
-- Those keep their outputs and their log; only new builds grow the list.

begin;

do $$
begin
  -- Nothing to add on a brand-new database: `db:push` will create the current
  -- schema, this table included, directly.
  if to_regclass('public.workshop_runs') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  create table if not exists run_resources (
    id bigserial primary key,
    run_id uuid not null references workshop_runs(id) on delete cascade,
    kind text not null,
    key text not null default '',
    label text not null,
    detail text,
    url text,
    done integer,
    total integer,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  -- The page's query: everything this run has built, in the order it was.
  create index if not exists run_resources_run_idx
    on run_resources (run_id, id);

  -- The runner's upsert target — one row per thing, however often it is
  -- re-applied.
  create unique index if not exists run_resources_identity_idx
    on run_resources (run_id, kind, key);
end $$;

commit;

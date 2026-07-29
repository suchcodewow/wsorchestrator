-- Add the event mode (workshop | challenge) to workshop_runs.
--
-- `drizzle-kit push` can create a new enum type and column on its own, but it
-- prompts before adding a NOT NULL column to a table with rows. Doing it here
-- with an explicit default means every existing run is a workshop — which is
-- what they all were — and the later `db:push` sees a matching schema.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-challenge    — type and column added, existing rows default to workshop
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  -- Nothing to alter on a brand-new database: `db:push` will create the
  -- current schema, enum included, directly.
  if to_regclass('public.workshop_runs') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  -- `create type` has no `if not exists`, so the guard is explicit.
  if not exists (select 1 from pg_type where typname = 'event_mode') then
    create type event_mode as enum ('workshop', 'challenge');
  else
    raise notice 'event_mode type already exists — skipped';
  end if;

  -- Every run that predates challenges is a workshop, so the default both
  -- backfills the existing rows and satisfies the NOT NULL in one step.
  alter table workshop_runs
    add column if not exists mode event_mode not null default 'workshop';
end $$;

commit;

-- What a saved Harness token's last deploy put into the organization.
--
-- One nullable jsonb column on `harness_tokens`, alongside the three columns
-- 0021 added for where and when. It holds `{ official, mySecrets, myTemplates }`
-- — the two ticks as booleans, and the user's own template sources named the way
-- the tokens page named them at the time, so the record still reads after a
-- source is renamed or removed.
--
-- Null for a token never deployed with, and also null for a deploy recorded
-- before this column existed: the tokens page then shows where it went without
-- claiming to know what went in.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-feature      — the column is added
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.harness_tokens') is null then
    raise notice 'no harness_tokens table — nothing to add deployed content to';
    return;
  end if;

  alter table harness_tokens
    add column if not exists deployed_content jsonb;
end $$;

commit;

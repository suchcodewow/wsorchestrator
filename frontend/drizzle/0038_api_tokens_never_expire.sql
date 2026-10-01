-- Personal access tokens no longer expire. A token now lasts until its owner
-- revokes it or their account is deleted, which removes it through
-- `api_tokens.user_id ... on delete cascade` (0017).
--
-- `expires_at` becomes nullable, null meaning "never". Manual tokens that are
-- still live get null too, so a token made last week does not die while one
-- made today lives on. Old bundle tokens keep their expiry and run out as
-- before; revoked and already-expired tokens are left as they are.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * pre-tokens       — skipped; 0017 creates the table
--   * already migrated — dropping a dropped not-null and nulling null rows are no-ops

begin;

do $$
begin
  if to_regclass('public.api_tokens') is null then
    raise notice 'no api_tokens table — nothing to migrate';
    return;
  end if;

  alter table api_tokens alter column expires_at drop not null;

  update api_tokens
     set expires_at = null
   where source = 'manual'
     and revoked_at is null
     and expires_at > now();
end $$;

commit;

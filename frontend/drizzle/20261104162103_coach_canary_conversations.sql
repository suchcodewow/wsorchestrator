-- Captain Canary was renamed Coach Canary. A coach conversation keeps the
-- system prompt it was started with, so those begun under the old name would
-- go on introducing themselves as Captain Canary; and the chat shows the
-- messages as they were saved. Both say Coach Canary from here on.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely
--   * before this      — the old name replaced
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.mimir_coach_conversations') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  update mimir_coach_conversations
  set system_prompt = replace(
    replace(
      system_prompt,
      'Earlier turns may call you Mimir, your old name; you are Captain Canary now and never call yourself Mimir.',
      'Earlier turns may call you Mimir or Captain Canary, your old names; you are Coach Canary now and never call yourself either.'
    ),
    'Captain Canary', 'Coach Canary'
  )
  where system_prompt like '%Captain Canary%';

  update mimir_coach_messages
  set text = replace(text, 'Captain Canary', 'Coach Canary'),
      content = replace(content::text, 'Captain Canary', 'Coach Canary')::jsonb
  where text like '%Captain Canary%' or content::text like '%Captain Canary%';
end $$;

commit;

-- Mimir, then Captain Canary, is now Coach Canary. A coach conversation keeps
-- the system prompt it was started with, so those begun under an old name
-- would go on introducing themselves by it; and the chat shows the messages
-- as they were saved. Prompts, the intro line in past replies and the hidden
-- opening request say Coach Canary from here on. Anything else a rep or the
-- coach wrote is left as it was.
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

  -- The sentence about old names keeps "Captain Canary", so it is put back
  -- after the rest of the prompt is renamed; that keeps this re-runnable.
  update mimir_coach_conversations
  set system_prompt = replace(
    replace(
      replace(system_prompt, 'Captain Canary', 'Coach Canary'),
      'Earlier turns may call you Mimir, your old name; you are Coach Canary now and never call yourself Mimir.',
      'Earlier turns may call you Mimir or Captain Canary, your old names; you are Coach Canary now and never call yourself either.'
    ),
    'Mimir or Coach Canary, your old names', 'Mimir or Captain Canary, your old names'
  )
  where system_prompt like '%Captain Canary%' or system_prompt like '%Mimir or Coach Canary, your old names%';

  update mimir_coach_conversations
  set system_prompt = replace(
    replace(
      system_prompt,
      'Mimir here, the Norse figure of wisdom, and your mentor for learning Harness.',
      'Coach Canary here, your coach on the sideline for learning Harness.'
    ),
    ' When the rep has just opened Mimir:',
    ' Earlier turns may call you Mimir or Captain Canary, your old names; you are Coach Canary now and never call yourself either. When the rep has just opened Coach Canary:'
  )
  where system_prompt like '% When the rep has just opened Mimir:%';

  update mimir_coach_messages
  set text = replace(text, 'Captain Canary', 'Coach Canary'),
      content = replace(content::text, 'Captain Canary', 'Coach Canary')::jsonb
  where text like '%Captain Canary%' or content::text like '%Captain Canary%';

  update mimir_coach_messages
  set text = replace(
        replace(text, 'Mimir here, the Norse figure of wisdom, and your mentor for learning Harness.', 'Coach Canary here, your coach on the sideline for learning Harness.'),
        'I just opened Mimir.', 'I just opened Coach Canary.'),
      content = replace(
        replace(content::text, 'Mimir here, the Norse figure of wisdom, and your mentor for learning Harness.', 'Coach Canary here, your coach on the sideline for learning Harness.'),
        'I just opened Mimir.', 'I just opened Coach Canary.')::jsonb
  where text like '%Mimir here, the Norse figure of wisdom%' or text like '%I just opened Mimir.%'
     or content::text like '%Mimir here, the Norse figure of wisdom%' or content::text like '%I just opened Mimir.%';
end $$;

commit;

-- drop_mimir_library: the previous Coach Canary's library is gone — its
-- pages, routes and code went first — so its tables go too: every card,
-- question and glossary term (mimir_items), each person's progress and
-- takeaways on them (mimir_progress), and the coach conversation each person
-- had on each card (mimir_conversations, mimir_messages). Nothing reads them.
-- The current coach's tables (mimir_coach_*, mimir_concept_*, mimir_map*,
-- mimir_profiles, mimir_settings, mimir_experience_progress,
-- mimir_studio_jobs) are not touched.
--
-- Safe to run on any database:
--   * fresh/empty      — nothing to drop
--   * before this      — the four tables dropped, children first
--   * already migrated — nothing changes

begin;

drop table if exists mimir_messages;
drop table if exists mimir_conversations;
drop table if exists mimir_progress;
drop table if exists mimir_items;

commit;

-- Logistics intake: one form per stage of the current cohort, Pre-Bootcamp
-- (`bootcamp`) and Pre-Intermediate (`intermediate`), and each response
-- under the form it answers. The one form there was becomes Pre-Bootcamp,
-- and every response already sent is counted as an answer to it. A form no
-- longer has a title or description: /intake heads each with its stage.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the form renamed and its title and description
--                        dropped; the column, check and index added
--   * already migrated — every step is a guarded no-op

begin;

do $$
begin
  if to_regclass('public.intake_forms') is null then
    raise notice 'fresh database — nothing to migrate';
    return;
  end if;

  alter table intake_forms drop constraint if exists intake_forms_id_check;
  update intake_forms set id = 'bootcamp' where id = 'intake';
  alter table intake_forms
    add constraint intake_forms_id_check check (id in ('bootcamp', 'intermediate'));
  alter table intake_forms drop column if exists title;
  alter table intake_forms drop column if exists description;

  alter table intake_responses add column if not exists form text not null default 'bootcamp';
  alter table intake_responses drop constraint if exists intake_responses_form_check;
  alter table intake_responses
    add constraint intake_responses_form_check check (form in ('bootcamp', 'intermediate'));

  drop index if exists intake_responses_email_idx;
  create index if not exists intake_responses_form_email_idx on intake_responses (form, email, submitted_at);
end $$;

commit;

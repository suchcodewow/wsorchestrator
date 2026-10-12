-- An introduction for each intake form, shown above its first question at
-- /intake: the dates, the all-or-nothing rule and the travel arrangements.
--
-- A form saved before this would never show the new defaults, which only
-- apply to a form that has never been saved. So when this adds the column it
-- also fills in each saved form's introduction as the Google Form it replaces
-- had it, and gives a saved Pre-Intermediate with no questions the Google
-- Form's five. That happens once, when the column is added: every migration
-- re-runs on every deploy, and a later run must not undo an edit.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — the column added, and saved forms filled in
--   * already migrated — a guarded no-op

begin;

do $$
begin
  if to_regclass('public.intake_forms') is null then
    raise notice 'no intake_forms yet — nothing to migrate';
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'intake_forms' and column_name = 'introduction'
  ) then
    return;
  end if;

  alter table intake_forms add column introduction text not null default '';

  update intake_forms set introduction = $intro$Sales Bootcamp takes place from Tuesday November 17 through Friday November 20 in Dallas, Texas.

1) We strictly enforce an "All or Nothing" model where every person must attend the entirety of Bootcamp, no exceptions, even for customer meetings.

2) You will not be able to step out for any reason during Bootcamp sessions throughout the day.

3) If you already know that you will be on PTO any of the days between November 17-20 you should mark "No" in this form.

4) If you're traveling from EMEA or APAC, you are allowed to arrive on Monday Nov 16th to adjust to the time zone prior to Bootcamp Day 1. We recommend you do so if your schedule permits; we want you to be fresh and ready come Tuesday morning.

5) No departure flights before 2:00PM PST on Friday, Nov 20th.

Please discuss with your manager if anything above may prevent you from attending Bootcamp.$intro$ where id = 'bootcamp';

  update intake_forms set introduction = $intro$Intermediate Training takes place on November 17 - 19 in Dallas, Texas.

1) We strictly enforce an "All or Nothing" model where every person must attend all of Intermediate, no exceptions, even for customer meetings.

2) You will not be able to step out for any reason during Intermediate sessions throughout the day.

3) If you already know that you will be on PTO any of the days between November 17 -20 you should mark "No" in this form.

4) If you're traveling from EMEA or APAC, you are allowed to arrive on Sunday November 15th to adjust to the time zone prior to Intermediate Day 1. We recommend you do so if your schedule permits; we want you to be fresh and ready come Tuesday morning. We also understand many may not have flight options available Wednesday evening, so please mark on the form exactly which nights you will need a hotel for.

5) No departure flights before 2PM PST on Thursday, November 19.

Please discuss with your manager if anything above may prevent you from attending Intermediate.

Also, please input accurate responses below as they help us plan our agenda, hotel blocks, and catered meals.$intro$ where id = 'intermediate';

  update intake_forms set questions = $questions$[{"description":"","options":["Yes - I'm there!","No - I can't make it."],"other":true,"id":"attend","kind":"choice","title":"Intermediate takes place in-person on November 17 - 19, will you be there","required":false},{"description":"","options":["Yes","No"],"other":false,"id":"dietary","kind":"dropdown","title":"Are there any dietary restrictions that we should try to accommodate? (check yes for vegetarian, vegan, allergies, etc. and describe in the following field)","required":true},{"description":"","options":[],"other":false,"id":"dietary-needs","kind":"paragraph","title":"If yes, please describe your dietary needs.","required":false},{"description":"","options":[],"other":false,"id":"dietary-critical","kind":"paragraph","title":"On a scale of 1 to 5, how critical are your dietary/allergy needs?","required":false},{"description":"If you have received a copy of the Harness Value Framework V2.0 please bring it to training. If not, we will provide you with one.\n\nYou will need to pass an Intermediate entrance exam, so make sure to complete your pre-work in advance to prepare!","options":[],"other":false,"id":"concerns","kind":"short","title":"Any other concerns or special considerations we should be aware of? Write them in here.","required":false}]$questions$::jsonb
  where id = 'intermediate' and questions = '[]'::jsonb;
end $$;

commit;

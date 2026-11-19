-- iris_text_answers: typed answers to the Diagnostic's free-text questions,
-- each with Claude's grade, and the queue of grades Claude was unsure of for
-- Diagnostic Settings → Grades. iris_responses.choice also allows -2, which
-- marks a typed answer.
--
-- Safe to run on any database:
--   * fresh/empty      — skipped entirely; db:push creates the schema outright
--   * before this      — table, indexes and the wider choice check created
--   * already migrated — nothing changes

begin;

do $$
begin
  if to_regclass('public.iris_responses') is null then
    raise notice 'no iris_responses yet — nothing to migrate';
    return;
  end if;

  alter table iris_responses drop constraint if exists iris_responses_choice_check;
  alter table iris_responses
    add constraint iris_responses_choice_check check (choice between -2 and 3);

  create table if not exists iris_text_answers (
    attempt_id uuid not null,
    seq integer not null,
    answer text not null,
    key_version integer not null,
    model text not null,
    graded_correct boolean not null,
    matched text[] not null default '{}'::text[],
    confidence text not null,
    reason text not null default '',
    review_status text,
    reviewed_by text references users (id) on delete set null,
    reviewed_at timestamptz,
    graded_at timestamptz not null default now(),
    constraint iris_text_answers_attempt_id_seq_pk primary key (attempt_id, seq),
    constraint iris_text_answers_response_fk foreign key (attempt_id, seq)
      references iris_responses (attempt_id, seq) on delete cascade,
    constraint iris_text_answers_confidence_check check (confidence in ('high', 'low')),
    constraint iris_text_answers_review_status_check
      check (review_status is null or review_status in ('pending', 'upheld', 'overturned'))
  );
  create index if not exists iris_text_answers_review_idx on iris_text_answers (review_status, graded_at);
end
$$;

commit;

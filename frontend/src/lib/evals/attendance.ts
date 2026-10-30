/**
 * Who attended a class, read from assessments: someone attended a bootcamp's
 * BTC or INT class when they have a submission for an assessment of that
 * stage at it, and that class has been released. Releasing a class is what
 * moves its people on, so a class still being judged counts no one yet.
 *
 * Each is an SQL fragment over `email`, a lowercased email expression from
 * the surrounding query; submissions are stored lowercased. Their own aliases
 * are prefixed so an outer `s`, `a` or `b` is never shadowed.
 */

import { sql, type SQL } from "drizzle-orm";
import { bootcamps, evalsAssessments, evalsSubmissions, type EvalsAssessmentStage } from "@/db/schema";

type ClassStage = Extract<EvalsAssessmentStage, "bootcamp" | "intermediate">;

/** Only classes held before this day, `YYYY-MM-DD`, count. */
export type AttendanceOptions = { before?: string };

/** The `from` and `where` of `email`'s submissions in released classes of `stage`. */
function releasedSubmissions(stage: ClassStage, email: SQL, options: AttendanceOptions = {}): SQL {
  const releasedAt = stage === "bootcamp" ? sql`att_b.btc_released_at` : sql`att_b.int_released_at`;
  // The stage is written in rather than bound, so the same fragment in a select
  // and its group by reads alike to Postgres; it is one of two fixed words.
  const stageLiteral = sql.raw(stage === "bootcamp" ? "'bootcamp'" : "'intermediate'");
  return sql`from ${evalsSubmissions} att_s
      join ${evalsAssessments} att_a on att_a.id = att_s.assessment_id
      join ${bootcamps} att_b on att_b.id = att_s.bootcamp_id
     where att_s.attendee_email = ${email} and att_a.stage = ${stageLiteral} and ${releasedAt} is not null
       ${options.before ? sql`and att_b.start_date < ${options.before}` : sql``}`;
}

/** True when `email` attended a class of `stage`. */
export function attended(stage: ClassStage, email: SQL, options?: AttendanceOptions): SQL<boolean> {
  return sql<boolean>`exists (select 1 ${releasedSubmissions(stage, email, options)})`;
}

/** The day, `YYYY-MM-DD`, of the latest class of `stage` `email` attended; null for none. */
export function classDate(stage: ClassStage, email: SQL): SQL<string | null> {
  return sql<string | null>`(select max(att_b.start_date)::text ${releasedSubmissions(stage, email)})`;
}

/**
 * How `email` did at the latest class of `stage` they attended: the mean of
 * their submissions' averages there, to one decimal place; null for none.
 */
export function classScore(stage: ClassStage, email: SQL): SQL<number | null> {
  return sql<number | null>`(select round(avg(att_s.average_score)::numeric, 1)::float8
      ${releasedSubmissions(stage, email)}
       and att_b.start_date = ${classDate(stage, email)}::date)`;
}

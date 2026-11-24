/**
 * Who registered for which class (`bootcamp_registrations`). Saving a
 * registration form registers its author for the class the form offers then:
 * the next bootcamp for Pre-Bootcamp, the next holding an intermediate class
 * for Pre-Intermediate, as `nextBootcamp` and `nextIntermediate` find them.
 * Saving it again keeps the one row. A class's list reads it through
 * `registeredFor`, which leaves out anyone who has since left HiBob or moved
 * to a track that is not trained, such as Deferred. Whether someone has
 * answered their form, for the RSVP mark, the reminders and the form itself,
 * is whether they are registered for the next class (`registeredForNext`).
 */

import "server-only";

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bootcampRegistrations, bootcamps, employees, intakeResponses, type IntakeFormId } from "@/db/schema";
import { nextBootcamp, nextIntermediate } from "@/lib/evals/tracks";

/** The bootcamp whose `stage` class a form saved now registers for; null when none is active or scheduled. */
export async function nextClassOf(stage: IntakeFormId): Promise<{ id: string; startDate: string } | null> {
  const next = stage === "bootcamp" ? await nextBootcamp() : await nextIntermediate();
  return next && { id: next.id, startDate: next.startDate };
}

/**
 * Registers `email` for the next `stage` class, or updates when they last
 * saved for it. Returns the bootcamp, or null when there is no class to
 * register for, which leaves their answers saved and them on no class list.
 */
export async function register(
  stage: IntakeFormId,
  email: string,
  test: boolean,
  executor: Pick<typeof db, "insert"> = db,
): Promise<{ id: string; startDate: string } | null> {
  const next = await nextClassOf(stage);
  if (!next) return null;
  const now = new Date();
  await executor
    .insert(bootcampRegistrations)
    .values({ bootcampId: next.id, stage, email: email.trim().toLowerCase(), test, registeredAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [bootcampRegistrations.bootcampId, bootcampRegistrations.stage, bootcampRegistrations.email],
      set: { updatedAt: now, test },
    });
  return next;
}

/** Deletes every registration the cohort test group saved, as turning the group off does. */
export async function deleteTestRegistrations(): Promise<void> {
  await db.delete(bootcampRegistrations).where(eq(bootcampRegistrations.test, true));
}

/**
 * The people registered for `bootcamp`'s classes in `stages`, as a query
 * giving each one's `email` and `stage`: someone HiBob still sends, on a track
 * that is trained. Someone deferred, ignored or exempt since registering is
 * left out, as is someone who has left, and the test group, whose
 * registrations are never a real class's.
 */
export function registeredFor(bootcampId: string | SQL, stages: SQL): SQL {
  return sql`
    select r.email, r.stage from ${bootcampRegistrations} r
     where r.bootcamp_id = ${bootcampId} and r.stage in (${stages})
       and not r.test and exists (
             select 1 from ${employees} re
              where lower(re.email) = r.email and re.active
                and coalesce(re.track, '') not in ('deferred', 'ignored', 'exempt'))`;
}

/**
 * The bootcamp whose `stage` class a form saved now registers for, in SQL:
 * `nextClassOf` as a subquery, null when none is active or scheduled.
 */
function nextClassSql(stage: SQL): SQL {
  return sql`(select nb.id from ${bootcamps} nb
     where (nb.status = 'active' or (nb.status = 'scheduled' and nb.start_date >= current_date))
       and (${stage} = 'bootcamp' or nb.int_days is not null)
     order by (nb.status = 'active') desc, nb.start_date
     limit 1)`;
}

/**
 * True when `email` (lowercased) has answered their `stage` form for the
 * next class: registered for it. With no class to register for, any answers
 * they saved to the form count, as before registrations, so no one is asked
 * for what they cannot give. A registration for an earlier class does not
 * count, so someone who did not attend it is asked again.
 */
export function registeredForNext(stage: SQL, email: SQL, test?: boolean): SQL<boolean> {
  const next = nextClassSql(stage);
  // Only the test group's, or only the real cohort's, when asked.
  const mode = test === undefined ? sql`` : sql` and nr.test = ${test}`;
  return sql<boolean>`(case when ${next} is null
      then exists (select 1 from ${intakeResponses} nr where nr.form = ${stage} and nr.email = ${email}${mode})
      else exists (select 1 from ${bootcampRegistrations} nr where nr.bootcamp_id = ${next} and nr.stage = ${stage} and nr.email = ${email}${mode})
    end)`;
}

/**
 * Which of `emails`, lowercased, have answered `stage`'s form for the next
 * class (`registeredForNext`); with `test`, counting only the test group's
 * registrations, or only the real cohort's.
 */
export async function registeredForNextOf(stage: IntakeFormId, emails: string[], test?: boolean): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ email: intakeResponses.email })
    .from(intakeResponses)
    .where(
      and(
        eq(intakeResponses.form, stage),
        inArray(intakeResponses.email, emails),
        registeredForNext(sql`${stage}`, sql`${intakeResponses.email}`, test),
      ),
    );
  return new Set(rows.map((r) => r.email));
}

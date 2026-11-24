/**
 * Who registered for which class (`bootcamp_registrations`). Saving a
 * registration form registers its author for the class the form offers then:
 * the next bootcamp for Pre-Bootcamp, the next holding an intermediate class
 * for Pre-Intermediate, as `nextBootcamp` and `nextIntermediate` find them.
 * Saving it again keeps the one row. A class's list reads it through
 * `registeredFor`, which leaves out anyone who has since left HiBob or moved
 * to a track that is not trained, such as Deferred.
 */

import "server-only";

import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bootcampRegistrations, employees, type IntakeFormId } from "@/db/schema";
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

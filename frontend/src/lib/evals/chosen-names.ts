/**
 * The name someone chose for themselves on the Pre-Bootcamp form, which the
 * app shows in place of the one their email gives. It is kept in
 * `employees.chosen_name` and written straight away wherever a name of theirs
 * is shown:
 *
 * - `employees`: their `full_name`, and `reports_to_name` for anyone who
 *   reports to them, so the employee list, the Cohorts page, name cards,
 *   eVals and the Slack reminders read it with nothing of their own to do;
 *   then the copies kept with judges, contacts and breakout groups
 *   (`refreshNameCopies`).
 * - Their account, `users.name`: the user menu, Manage users, and wherever
 *   the app names who did something. Signing in keeps it rather than taking
 *   Google's name again (`lib/google-profile.ts`).
 * - The names kept with what they wrote, own or did: session comments,
 *   checklist items, transcripts, who tagged someone, and the guest speaker
 *   history.
 *
 * Two kinds of record keep the name they were made with: a mention of them,
 * whose text spells it, and the audit trail, which is history. The HiBob
 * sync leaves `chosen_name` alone and keeps `full_name` to it.
 */

import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  evalsTranscripts,
  guestSpeakerHistory,
  mentions,
  scheduleChecklistItems,
  scheduleSessionComments,
  users,
} from "@/db/schema";
import { refreshNameCopies, type Tx } from "@/lib/evals/hibob";
import { toEmployeeRow } from "@/lib/evals/hibob-record";
import { normalizeName } from "@/lib/logistics/intake-values";

/** The name the app has for `email` now, chosen or not; null for an email no employee has. */
export async function nameOnRecord(email: string): Promise<string | null> {
  const [row] = await db
    .select({ fullName: employees.fullName })
    .from(employees)
    .where(sql`lower(${employees.email}) = ${email.toLowerCase()}`)
    .orderBy(employees.fullName)
    .limit(1);
  return row?.fullName ?? null;
}

/**
 * Makes `name` the one the app shows for `email`. The name their email gives
 * (`nameFromEmail`, from what HiBob last sent) needs no row, so choosing it
 * clears theirs. Returns whether they are an employee; nothing is kept for
 * an email no employee has.
 */
export async function setChosenName(email: string, name: string): Promise<boolean> {
  const address = email.toLowerCase();
  const fullName = normalizeName(name);
  return db.transaction(async (tx) => {
    // The HiBob sync's lock: it updates `employees`, and reads chosen names, under it.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hibob_employees'))`);
    const [employee] = await tx
      .select({ raw: employees.raw })
      .from(employees)
      .where(sql`lower(${employees.email}) = ${address}`)
      .limit(1);
    if (!employee) return false;

    const fromEmail = toEmployeeRow(employee.raw)?.fullName;
    const chosenName = fullName === fromEmail ? null : fullName;
    await tx
      .update(employees)
      .set({ fullName, chosenName })
      .where(sql`lower(${employees.email}) = ${address}`);
    await tx.update(employees).set({ reportsToName: fullName }).where(eq(employees.reportsToEmail, address));
    await refreshNameCopies(tx);
    await renameEverywhereElse(tx, address, fullName);
    return true;
  });
}

/** Their account and the names kept with what they wrote, own or did, by `address`, lowercased. */
async function renameEverywhereElse(tx: Tx, address: string, fullName: string): Promise<void> {
  const theirAccounts = sql`(select ${users.id} from ${users} where lower(${users.email}) = ${address})`;
  await tx.update(users).set({ name: fullName }).where(sql`lower(${users.email}) = ${address}`);

  const c = scheduleSessionComments;
  await tx.update(c).set({ authorName: fullName }).where(sql`lower(${c.authorEmail}) = ${address} or ${c.authorId} in ${theirAccounts}`);

  const k = scheduleChecklistItems;
  await tx.update(k).set({ ownerName: fullName }).where(sql`lower(${k.ownerEmail}) = ${address}`);
  await tx.update(k).set({ doneByName: fullName }).where(sql`${k.doneBy} in ${theirAccounts}`);
  await tx.update(k).set({ createdByName: fullName }).where(sql`lower(${k.createdByEmail}) = ${address} or ${k.createdBy} in ${theirAccounts}`);

  const t = evalsTranscripts;
  await tx.update(t).set({ recordedByName: fullName }).where(sql`${t.recordedById} in ${theirAccounts}`);

  // Who tagged someone; the person tagged keeps the name the mention's text spells.
  const m = mentions;
  await tx.update(m).set({ taggedByName: fullName }).where(sql`lower(${m.taggedByEmail}) = ${address} or ${m.taggedBy} in ${theirAccounts}`);

  // One entry per cohort, program, session, role and name: an entry already under the new name stays as it is.
  // Aliased by hand: Drizzle writes bare column names, which inside the subquery would mean its own.
  await tx.execute(sql`
    update ${guestSpeakerHistory} h set full_name = ${fullName}
    where lower(h.email) = ${address} and h.full_name <> ${fullName}
      and not exists (
        select 1 from ${guestSpeakerHistory} other
        where other.cohort = h.cohort and other.program = h.program and other.session = h.session
          and other.role = h.role and other.full_name = ${fullName}
      )`);
}

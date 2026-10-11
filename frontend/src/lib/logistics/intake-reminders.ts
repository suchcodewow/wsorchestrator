/**
 * The intake form's daily Slack reminder: who is due one, and when. Everyone
 * in the current cohort (`currentCohortEmails`) who has not yet saved answers
 * to their stage's form is sent a direct message linking to /intake; a stage
 * whose form has no questions is sent nothing.
 *
 * The cohort Slack sync sends them (`lib/cohorts/slack-sync.ts`), and logs
 * them with everything else it does: once a day from Cloud Scheduler
 * (infra/admin/scheduler.tf), and with Sync Slack Now on Cohort Settings →
 * Slack. In the sync's dry run they are logged, not sent. Nothing is sent at
 * all until a Training Administrator turns reminders on in Logistics settings
 * → Reminders, and then at most once per America/New_York day, so a retried
 * or second run does not message anyone twice.
 */

import "server-only";

import { eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { EVALS_SETTINGS_KEYS, INTAKE_FORM_IDS, evalsSettings, type IntakeFormId } from "@/db/schema";
import { currentCohortEmails } from "@/lib/evals/current-cohort";
import { answeredIntake, getIntakeForm } from "@/lib/logistics/intake";
import { slackToken } from "@/lib/slack";
import { SLACK_DM_SCOPES, getSlackInstallation } from "@/lib/slack-app";

async function readSetting(key: string): Promise<string | null> {
  const [row] = await db.select({ value: evalsSettings.value }).from(evalsSettings).where(eq(evalsSettings.key, key));
  return row?.value ?? null;
}

/** Whether reminders are sent; off until an administrator turns them on. */
export async function getIntakeRemindersOn(): Promise<boolean> {
  return (await readSetting(EVALS_SETTINGS_KEYS.intakeRemindersOn)) === "true";
}

export async function setIntakeRemindersOn(actorId: string, on: boolean): Promise<void> {
  const value = on ? "true" : "false";
  await db
    .insert(evalsSettings)
    .values({ key: EVALS_SETTINGS_KEYS.intakeRemindersOn, value, updatedBy: actorId })
    .onConflictDoUpdate({ target: evalsSettings.key, set: { value, updatedBy: actorId, updatedAt: new Date() } });
}

/** Today in America/New_York, `YYYY-MM-DD`: the day the scheduler's cron is set in. */
function easternDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** Whether today's reminders have gone out. */
export async function intakeRemindersSentToday(): Promise<boolean> {
  return (await readSetting(EVALS_SETTINGS_KEYS.intakeRemindersSentOn)) === easternDay();
}

/**
 * Marks today's reminders as sent, or false if they already were. One
 * statement, so two runs racing each other cannot both win.
 */
export async function claimIntakeRemindersToday(): Promise<boolean> {
  const today = easternDay();
  const claimed = await db
    .insert(evalsSettings)
    .values({ key: EVALS_SETTINGS_KEYS.intakeRemindersSentOn, value: today })
    .onConflictDoUpdate({
      target: evalsSettings.key,
      set: { value: today, updatedAt: new Date() },
      setWhere: ne(evalsSettings.value, today),
    })
    .returning({ key: evalsSettings.key });
  return claimed.length > 0;
}

export type OutstandingIntake = { email: string; fullName: string; form: IntakeFormId };

/** By form: how many in the cohort are asked it, how many of them have answered, and how many questions it has. */
export type IntakeCounts = Record<IntakeFormId, { asked: number; answered: number; questions: number }>;

/** Everyone in the current cohort yet to answer their stage's form, leaving out a stage whose form asks nothing. */
export async function outstandingIntake(): Promise<{ outstanding: OutstandingIntake[]; counts: IntakeCounts }> {
  const cohort = await currentCohortEmails();
  const outstanding: OutstandingIntake[] = [];
  const counts = {} as IntakeCounts;
  for (const form of INTAKE_FORM_IDS) {
    const members = [...new Map(cohort.filter((m) => m.stage === form).map((m) => [m.email, m])).values()];
    const [{ questions }, answered] = await Promise.all([
      getIntakeForm(form),
      answeredIntake(
        form,
        members.map((m) => m.email),
      ),
    ]);
    counts[form] = { asked: members.length, answered: answered.size, questions: questions.length };
    if (questions.length === 0) continue;
    for (const m of members) if (!answered.has(m.email)) outstanding.push({ email: m.email, fullName: m.fullName, form });
  }
  return { outstanding, counts };
}

/** Whether a bot token is set, and which of the reminders' scopes an installed app was not granted. */
export async function intakeReminderSlack(): Promise<{ configured: boolean; missingScopes: string[] }> {
  const [token, installation] = await Promise.all([slackToken(), getSlackInstallation()]);
  return {
    configured: token !== null,
    missingScopes: installation?.readable ? SLACK_DM_SCOPES.filter((s) => !installation.scopes.includes(s)) : [],
  };
}

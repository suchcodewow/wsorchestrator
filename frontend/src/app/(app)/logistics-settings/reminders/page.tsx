/** The Reminders tab: the intake form's daily Slack reminder, whether it is on, and the last run that sent it. */

import { getSlackSyncLive, lastReminderRun } from "@/lib/cohorts/slack-sync";
import {
  getIntakeRemindersOn,
  intakeReminderSlack,
  intakeRemindersSentToday,
  outstandingIntake,
} from "@/lib/logistics/intake-reminders";
import { RemindersView } from "./reminders-view";

export default async function IntakeRemindersPage() {
  const [on, live, sentToday, lastRun, { counts }, slack] = await Promise.all([
    getIntakeRemindersOn(),
    getSlackSyncLive(),
    intakeRemindersSentToday(),
    lastReminderRun(),
    outstandingIntake(),
    intakeReminderSlack(),
  ]);
  return (
    <RemindersView
      on={on}
      live={live}
      sentToday={sentToday}
      lastRun={lastRun && { ...lastRun, startedAt: lastRun.startedAt.toISOString(), finishedAt: lastRun.finishedAt?.toISOString() ?? null }}
      counts={counts}
      slack={slack}
    />
  );
}

/**
 * Turning the test group off: archives the Slack channels it made, cancels
 * the calendar invites it sent, and clears the day's intake reminder claim so
 * the real ones are not held back. The group stays on if any of that fails, so
 * nothing is left behind and unrecorded; try again.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { EVALS_SETTINGS_KEYS, evalsSettings } from "@/db/schema";
import { archiveTestChannels } from "@/lib/cohorts/slack-sync";
import { cancelTestMeetings } from "@/lib/evals/google-meetings-sync";

export async function takeDownTestGroup(): Promise<{
  ok: boolean;
  archived: string[];
  cancelled: number;
  failures: string[];
}> {
  const [channels, meetings] = await Promise.all([
    archiveTestChannels(),
    cancelTestMeetings(),
  ]);
  const failures = [...channels.failures, ...meetings.failures];
  if (failures.length === 0) {
    await db
      .delete(evalsSettings)
      .where(eq(evalsSettings.key, EVALS_SETTINGS_KEYS.intakeRemindersSentOn));
  }
  return {
    ok: failures.length === 0,
    archived: channels.archived,
    cancelled: meetings.cancelled,
    failures,
  };
}

/**
 * Announcing a day's surveys in the class's cohort channel when the
 * scheduler's "Assign Surveys" sends them: `sales-bootcamp-nov-2026` for
 * the Bootcamp button, `se-bootcamp-nov-2026` for SE Bootcamp, and so on.
 *
 * It posts only with the Slack sync live, since QA shares production's
 * workspace and stays in dry run, and only to a channel the sync has made.
 * With the test group on, it posts to the test group's channel instead.
 * Nothing here fails the sending: the outcome is reported, never thrown.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bootcamps, slackChannels, type ScheduleTrack } from "@/db/schema";
import { cohortChannels } from "@/lib/cohorts/slack-plan";
import { getSlackSyncLive } from "@/lib/cohorts/slack-sync";
import { getTestGroup } from "@/lib/cohorts/test-group";
import { dayDate } from "@/lib/scheduler/timeline";
import { SlackError, SlackOutOfTime, slackClient, slackToken } from "@/lib/slack";
import { surveyAnnouncementText, surveyChannelKind, type SurveySlackOutcome } from "@/lib/surveys/survey-values";

/** How long to wait on Slack before giving up; the manager is waiting on the button. */
const DEADLINE_MS = 15_000;

/** Announces `track`'s day `day` surveys, linking to `intakeUrl`; null when the bootcamp is gone. */
export async function announceDaySurveys(
  bootcampId: string,
  track: ScheduleTrack,
  day: number,
  intakeUrl: string,
): Promise<SurveySlackOutcome | null> {
  const [bootcamp] = await db
    .select({ startDate: bootcamps.startDate, intDays: bootcamps.intDays })
    .from(bootcamps)
    .where(eq(bootcamps.id, bootcampId));
  if (!bootcamp) return null;

  const group = await getTestGroup();
  const kind = surveyChannelKind(track);
  const channel = cohortChannels(bootcamp.startDate, bootcamp.intDays !== null, group.on ? group.suffix : null).find(
    (c) => c.kind === kind,
  );
  if (!channel) return null;
  const name = channel.name;

  const [stored] = await db.select({ id: slackChannels.slackChannelId }).from(slackChannels).where(eq(slackChannels.name, name));
  if (!stored) return { channel: name, status: "no_channel" };
  if (!(await getSlackSyncLive())) return { channel: name, status: "dry_run" };
  const token = await slackToken();
  if (!token) return { channel: name, status: "not_connected" };

  try {
    await slackClient(token, Date.now() + DEADLINE_MS).call("chat.postMessage", {
      channel: stored.id,
      text: surveyAnnouncementText(day, dayDate(bootcamp.startDate, day), intakeUrl),
      unfurl_links: "false",
    });
    return { channel: name, status: "posted" };
  } catch (err) {
    if (err instanceof SlackError) return { channel: name, status: "failed", error: err.error };
    if (err instanceof SlackOutOfTime) return { channel: name, status: "failed", error: "timed_out" };
    throw err;
  }
}

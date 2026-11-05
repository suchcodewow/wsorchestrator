/**
 * Telling managers a class has been released: one Slack direct message to
 * everyone in the management chain of anyone scored in it, and to each of the
 * Additional Slack Contacts, linking to Reporting → Live Sessions.
 *
 * It sends only with the Slack sync live, since QA shares production's
 * workspace and stays in dry run. With the test group on, it messages the
 * group's members for that class instead of any manager. Nothing here fails
 * the release: the outcome is reported, never thrown.
 */

import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { getSlackSyncLive, isFatal, resolveSlackUsers } from "@/lib/cohorts/slack-sync";
import { getTestGroup } from "@/lib/cohorts/test-group";
import { slackContactEmails } from "@/lib/evals/slack-contacts";
import type { ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { releaseNoticeRecipients, releaseNoticeText } from "@/lib/reporting/release-notice-values";
import { SlackError, SlackOutOfTime, slackClient, slackToken } from "@/lib/slack";
import { SLACK_DM_SCOPES, getSlackInstallation } from "@/lib/slack-app";

/** How long to spend messaging; the administrator is waiting on the button. */
const DEADLINE_MS = 60_000;

export type ReleaseNotice = {
  /** sent: every recipient was tried. The rest sent nothing. */
  status: "sent" | "dry_run" | "not_connected" | "missing_scopes" | "failed";
  /** True when the test group was on, so `recipients` are its members. */
  testGroup: boolean;
  recipients: number;
  messaged: number;
  notInSlack: number;
  failed: number;
  /** Slack's error, when a call failed. */
  error?: string;
};

/**
 * Who is told: the managers of `attendees` (lowercased emails) and the
 * Additional Slack Contacts, or the test group's members for `stage`.
 */
async function recipientsOf(stage: ReleaseStage, attendees: string[]): Promise<{ emails: string[]; testGroup: boolean }> {
  const group = await getTestGroup();
  if (group.on) {
    return {
      emails: group.members.filter((m) => m.stage === stage || m.stage === "both").map((m) => m.email),
      testGroup: true,
    };
  }
  const chains: (string | null)[] = [];
  for (let i = 0; i < attendees.length; i += 500) {
    const rows = await db
      .select({ chain: employees.managementChain })
      .from(employees)
      .where(and(inArray(employees.email, attendees.slice(i, i + 500)), eq(employees.active, true)));
    chains.push(...rows.map((r) => r.chain));
  }
  return { emails: releaseNoticeRecipients(chains, await slackContactEmails()), testGroup: false };
}

/** Messages the managers of `attendees`, the people scored in `stage` at the bootcamp starting `startDate`. */
export async function notifyRelease(
  stage: ReleaseStage,
  startDate: string,
  attendees: string[],
  reportingUrl: string,
): Promise<ReleaseNotice> {
  const { emails, testGroup } = await recipientsOf(stage, attendees);
  const notice: ReleaseNotice = { status: "sent", testGroup, recipients: emails.length, messaged: 0, notInSlack: 0, failed: 0 };
  if (emails.length === 0) return notice;
  if (!(await getSlackSyncLive())) return { ...notice, status: "dry_run" };
  const token = await slackToken();
  if (!token) return { ...notice, status: "not_connected" };
  const installation = await getSlackInstallation();
  if (installation?.readable && SLACK_DM_SCOPES.some((s) => !installation.scopes.includes(s))) {
    return { ...notice, status: "missing_scopes" };
  }

  const slack = slackClient(token, Date.now() + DEADLINE_MS);
  const text = releaseNoticeText(stage, startDate, reportingUrl);
  try {
    const ids = await resolveSlackUsers(slack, emails);
    for (const email of emails) {
      const user = ids.get(email);
      if (!user) {
        notice.notInSlack++;
        continue;
      }
      try {
        const { channel } = await slack.call<{ channel: { id: string } }>("conversations.open", { users: user });
        await slack.call("chat.postMessage", { channel: channel.id, text, unfurl_links: "false" });
        notice.messaged++;
      } catch (err) {
        if (!(err instanceof SlackError) || isFatal(err)) throw err;
        notice.failed++;
        notice.error = err.error;
      }
    }
    return notice;
  } catch (err) {
    const error = err instanceof SlackError ? err.error : err instanceof SlackOutOfTime ? "timed_out" : null;
    if (!error) throw err;
    return { ...notice, status: "failed", error, failed: emails.length - notice.messaged - notice.notInSlack };
  }
}

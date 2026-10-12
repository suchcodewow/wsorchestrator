/**
 * The Slack tab: everything the app sends through Slack. The app's install,
 * dry run or live, the intake form's daily reminder and how each form stands,
 * the active bootcamp's channels, previewing and syncing now, and the sync's
 * log a page at a time.
 */

import {
  activeCohortChannels,
  getSlackSyncLive,
  listSlackSyncRuns,
  slackSyncInProgress,
} from "@/lib/cohorts/slack-sync";
import { SLACK_SYNC_LIST } from "@/lib/list-specs";
import { getIntakeRemindersOn, intakeRemindersSentToday, outstandingIntake } from "@/lib/logistics/intake-reminders";
import { parseListQuery } from "@/lib/paging";
import { envSlackToken } from "@/lib/slack";
import { getSlackInstallation, slackApp } from "@/lib/slack-app";
import { SlackSyncView } from "./slack-view";

export default async function SlackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseListQuery(params, SLACK_SYNC_LIST);
  const [page, running, live, active, installation, remindersOn, sentToday, { counts }] = await Promise.all([
    listSlackSyncRuns(query),
    slackSyncInProgress(),
    getSlackSyncLive(),
    activeCohortChannels(),
    getSlackInstallation(),
    getIntakeRemindersOn(),
    intakeRemindersSentToday(),
    outstandingIntake(),
  ]);
  const envToken = Boolean(envSlackToken());
  // How Add to Slack went, as the shared OAuth callback (lib/oauth-purposes.ts) put it in the URL.
  const result = typeof params.slack === "string" ? params.slack : null;

  return (
    <SlackSyncView
      configured={Boolean(installation?.readable) || envToken}
      connection={{
        appConfigured: Boolean(slackApp()),
        envToken,
        installation: installation && { ...installation, installedAt: installation.installedAt.toISOString() },
      }}
      installResult={result ? { result, detail: typeof params.detail === "string" ? params.detail : null } : null}
      live={live}
      active={active}
      reminders={{ on: remindersOn, sentToday, counts }}
      query={query}
      running={running}
      page={{
        ...page,
        rows: page.rows.map((run) => ({
          ...run,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
        })),
      }}
    />
  );
}

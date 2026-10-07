/** The Slack tab: the app's install, the active bootcamp's channels, dry run or live, syncing now, and the sync's log a page at a time. */

import {
  activeCohortChannels,
  getSlackSyncLive,
  listSlackSyncRuns,
  slackSyncInProgress,
} from "@/lib/cohorts/slack-sync";
import { SLACK_SYNC_LIST } from "@/lib/list-specs";
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
  const [page, running, live, active, installation] = await Promise.all([
    listSlackSyncRuns(query),
    slackSyncInProgress(),
    getSlackSyncLive(),
    activeCohortChannels(),
    getSlackInstallation(),
  ]);
  const envToken = Boolean(envSlackToken());
  // How Add to Slack went, as `oauth/callback` put it in the URL.
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

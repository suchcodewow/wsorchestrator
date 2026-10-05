/** The Slack tab: the active bootcamp's channels, dry run or live, syncing now, and the sync's log a page at a time. */

import {
  activeCohortChannels,
  getSlackSyncLive,
  listSlackSyncRuns,
  slackSyncInProgress,
} from "@/lib/cohorts/slack-sync";
import { SLACK_SYNC_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { slackToken } from "@/lib/slack";
import { SlackSyncView } from "./slack-view";

export default async function SlackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, SLACK_SYNC_LIST);
  const [page, running, live, active] = await Promise.all([
    listSlackSyncRuns(query),
    slackSyncInProgress(),
    getSlackSyncLive(),
    activeCohortChannels(),
  ]);

  return (
    <SlackSyncView
      configured={Boolean(slackToken())}
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

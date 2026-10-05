/** One cohort Slack sync run: its result, then what it did, a page at a time. */

import { notFound } from "next/navigation";
import { z } from "zod";
import { getSlackSyncRun, listSlackSyncChanges } from "@/lib/cohorts/slack-sync";
import { SLACK_SYNC_CHANGE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { RunDetailView } from "./run-view";

export default async function SlackRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = z.string().uuid().safeParse((await params).id);
  const run = id.success ? await getSlackSyncRun(id.data) : null;
  if (!run) notFound();

  const query = parseListQuery(await searchParams, SLACK_SYNC_CHANGE_LIST);
  const page = await listSlackSyncChanges(run.id, query);
  return (
    <RunDetailView
      run={{ ...run, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null }}
      query={query}
      page={{ ...page, rows: page.rows.map((c) => ({ ...c, at: c.at.toISOString() })) }}
    />
  );
}

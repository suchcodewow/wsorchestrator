/** One cohort Slack sync run: its result, then what it did and sent, and to whom, a page at a time. */

import { notFound } from "next/navigation";
import { z } from "zod";
import {
  countSlackSyncChanges,
  getSlackSyncRun,
  isSlackChangeKind,
  listSlackSyncChanges,
} from "@/lib/cohorts/slack-sync";
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

  const asked = await searchParams;
  const query = parseListQuery(asked, SLACK_SYNC_CHANGE_LIST);
  const kind = isSlackChangeKind(asked.kind) ? asked.kind : null;
  const [page, counts] = await Promise.all([listSlackSyncChanges(run.id, query, kind), countSlackSyncChanges(run.id)]);
  return (
    <RunDetailView
      run={{ ...run, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null }}
      query={query}
      kind={kind}
      counts={counts}
      page={{ ...page, rows: page.rows.map((c) => ({ ...c, at: c.at.toISOString() })) }}
    />
  );
}

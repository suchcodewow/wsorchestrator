/** One Google Meetings sync run: its result, then whom it invited, took off and marked, a page at a time. */

import { notFound } from "next/navigation";
import { z } from "zod";
import {
  countMeetingSyncChanges,
  getMeetingSyncRun,
  isMeetingChangeKind,
  listMeetingSyncChanges,
} from "@/lib/evals/google-meetings";
import { MEETING_SYNC_CHANGE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { MeetingRunView } from "./run-view";

export default async function MeetingRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = z.string().uuid().safeParse((await params).id);
  const run = id.success ? await getMeetingSyncRun(id.data) : null;
  if (!run) notFound();

  const asked = await searchParams;
  const query = parseListQuery(asked, MEETING_SYNC_CHANGE_LIST);
  const kind = isMeetingChangeKind(asked.kind) ? asked.kind : null;
  const [page, counts] = await Promise.all([listMeetingSyncChanges(run.id, query, kind), countMeetingSyncChanges(run.id)]);
  return (
    <MeetingRunView
      run={{ ...run, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null }}
      query={query}
      kind={kind}
      counts={counts}
      page={{
        ...page,
        rows: page.rows.map((c) => ({ ...c, at: c.at.toISOString(), occurrenceStartsAt: c.occurrenceStartsAt?.toISOString() ?? null })),
      }}
    />
  );
}

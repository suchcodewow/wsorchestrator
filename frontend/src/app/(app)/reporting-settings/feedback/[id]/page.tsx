/** One release message run: its result, then who it messaged, or would have, a page at a time. */

import { notFound } from "next/navigation";
import { z } from "zod";
import { RELEASE_NOTICE_MESSAGE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import {
  countReleaseNoticeMessages,
  getReleaseNotice,
  isReleaseNoticeKind,
  listReleaseNoticeMessages,
} from "@/lib/reporting/release-notice";
import { NoticeRunView } from "./run-view";

export default async function ReleaseNoticePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = z
    .string()
    .uuid()
    .safeParse((await params).id);
  const run = id.success ? await getReleaseNotice(id.data) : null;
  if (!run) notFound();

  const asked = await searchParams;
  const query = parseListQuery(asked, RELEASE_NOTICE_MESSAGE_LIST);
  const kind = isReleaseNoticeKind(asked.kind) ? asked.kind : null;
  const [page, counts] = await Promise.all([listReleaseNoticeMessages(run.id, query, kind), countReleaseNoticeMessages(run.id)]);
  return (
    <NoticeRunView
      run={{ ...run, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null }}
      query={query}
      kind={kind}
      counts={counts}
      page={{ ...page, rows: page.rows.map((m) => ({ ...m, at: m.at.toISOString() })) }}
    />
  );
}

/**
 * Reporting Settings → Feedback Management: each class of the active
 * bootcamp, with its Generate, Preview and Release buttons, then the log of
 * every Slack message a release sent, or a preview or dry run would have, a
 * page at a time.
 */

import type { Metadata } from "next";
import { getSlackSyncLive } from "@/lib/cohorts/slack-sync";
import { pendingParticipation } from "@/lib/evals/participation";
import { RELEASE_NOTICE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { cohortBootcamp } from "@/lib/reporting/bootcamp";
import { listReleaseNotices } from "@/lib/reporting/release-notice";
import { FeedbackView } from "./feedback-view";

export const metadata: Metadata = { title: "Feedback Management" };

export default async function FeedbackManagementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, RELEASE_NOTICE_LIST);
  const [bootcamp, pending, live, page] = await Promise.all([
    cohortBootcamp(),
    pendingParticipation(),
    getSlackSyncLive(),
    listReleaseNotices(query),
  ]);

  return (
    <FeedbackView
      bootcamp={
        bootcamp && {
          startDate: bootcamp.startDate,
          intermediate: bootcamp.intermediate,
          released: {
            bootcamp: bootcamp.released.bootcamp && {
              at: bootcamp.released.bootcamp.at.toISOString(),
              byName: bootcamp.released.bootcamp.byName,
            },
            intermediate: bootcamp.released.intermediate && {
              at: bootcamp.released.intermediate.at.toISOString(),
              byName: bootcamp.released.intermediate.byName,
            },
          },
        }
      }
      pending={pending}
      slackLive={live}
      query={query}
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

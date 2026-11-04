/**
 * The Mimir Feedback tab: each concept on the map, its video's counts of
 * ratings, and its latest regeneration, a page at a time. Assessments
 * Administrators can also edit, accept and ignore comments, and those who may
 * run Mimir Studio can have a video made again or for the first time.
 */

import { auth } from "@/auth";
import { canManageEvalsSettings, canRunMimirStudio } from "@/lib/roles";
import { VIDEO_FEEDBACK_SUMMARY_LIST } from "@/lib/list-specs";
import { withVideoJobs } from "@/lib/mimir/studio/jobs";
import { parseListQuery } from "@/lib/paging";
import { listVideoFeedbackSummary } from "@/lib/video-feedback";
import { FeedbackView } from "./feedback-view";

export default async function MimirFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, VIDEO_FEEDBACK_SUMMARY_LIST);
  const [summary, session] = await Promise.all([listVideoFeedbackSummary(query), auth()]);
  const page = { ...summary, rows: await withVideoJobs(summary.rows) };
  const access = session?.user?.access;
  return (
    <FeedbackView
      query={query}
      page={page}
      canModerate={Boolean(access && canManageEvalsSettings(access))}
      canRegenerate={Boolean(access && canRunMimirStudio(access))}
    />
  );
}

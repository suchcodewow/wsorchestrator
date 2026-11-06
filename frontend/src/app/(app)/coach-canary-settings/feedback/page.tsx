/**
 * The Mimir Feedback tab: each concept on the map, its video's counts of
 * ratings, and its latest regeneration, a page at a time. Assessments
 * Administrators can also edit, accept and ignore comments, and those who may
 * run Mimir Studio can have a video made again or for the first time. Below
 * it, the ratings of slide review slides, each opening its slide.
 */

import { auth } from "@/auth";
import { canManageEvalsSettings, canRunMimirStudio } from "@/lib/roles";
import { SLIDE_FEEDBACK_LIST, VIDEO_FEEDBACK_SUMMARY_LIST } from "@/lib/list-specs";
import { listSlideFeedback } from "@/lib/mimir/slide-feedback";
import { withVideoJobs } from "@/lib/mimir/studio/jobs";
import { parseListQuery } from "@/lib/paging";
import { listVideoFeedbackSummary } from "@/lib/video-feedback";
import { FeedbackView } from "./feedback-view";
import { SLIDE_FEEDBACK_PREFIX, SlideFeedbackTable } from "./slide-feedback-table";

export default async function MimirFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseListQuery(params, VIDEO_FEEDBACK_SUMMARY_LIST);
  // The search box above belongs to the concept table, so the slide ratings ignore it.
  const slideQuery = { ...parseListQuery(params, SLIDE_FEEDBACK_LIST, SLIDE_FEEDBACK_PREFIX), q: "" };
  const [summary, session, slides] = await Promise.all([listVideoFeedbackSummary(query), auth(), listSlideFeedback(slideQuery)]);
  const page = { ...summary, rows: await withVideoJobs(summary.rows) };
  const access = session?.user?.access;
  return (
    <div className="space-y-10">
      <FeedbackView
        query={query}
        page={page}
        canModerate={Boolean(access && canManageEvalsSettings(access))}
        canRegenerate={Boolean(access && canRunMimirStudio(access))}
      />
      <SlideFeedbackTable query={slideQuery} page={slides} />
    </div>
  );
}

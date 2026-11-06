/**
 * The Coach Canary Feedback tab, one kind of feedback at a time. Video
 * Feedback: each concept on the map, its video's counts of ratings, and its
 * latest regeneration, a page at a time; Assessments Administrators can also
 * edit, accept and ignore comments, and those who may run Mimir Studio can
 * have a video made again or for the first time. Slide Game Feedback: the
 * ratings of slide review slides, each opening its slide.
 */

import { auth } from "@/auth";
import { canManageEvalsSettings, canRunMimirStudio } from "@/lib/roles";
import { SLIDE_FEEDBACK_LIST, VIDEO_FEEDBACK_SUMMARY_LIST } from "@/lib/list-specs";
import { listSlideFeedback } from "@/lib/mimir/slide-feedback";
import { withVideoJobs } from "@/lib/mimir/studio/jobs";
import { parseListQuery } from "@/lib/paging";
import { listVideoFeedbackSummary } from "@/lib/video-feedback";
import { FeedbackSwitch, feedbackKindOf } from "./feedback-switch";
import { FeedbackView } from "./feedback-view";
import { SlideFeedbackTable } from "./slide-feedback-table";

export default async function MimirFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const kind = feedbackKindOf(params.view);

  if (kind === "slides") {
    const query = parseListQuery(params, SLIDE_FEEDBACK_LIST);
    return (
      <div className="space-y-6">
        <FeedbackSwitch current={kind} />
        <SlideFeedbackTable query={query} page={await listSlideFeedback(query)} />
      </div>
    );
  }

  const query = parseListQuery(params, VIDEO_FEEDBACK_SUMMARY_LIST);
  const [summary, session] = await Promise.all([listVideoFeedbackSummary(query), auth()]);
  const page = { ...summary, rows: await withVideoJobs(summary.rows) };
  const access = session?.user?.access;
  return (
    <div className="space-y-6">
      <FeedbackSwitch current={kind} />
      <FeedbackView
        query={query}
        page={page}
        canModerate={Boolean(access && canManageEvalsSettings(access))}
        canRegenerate={Boolean(access && canRunMimirStudio(access))}
      />
    </div>
  );
}

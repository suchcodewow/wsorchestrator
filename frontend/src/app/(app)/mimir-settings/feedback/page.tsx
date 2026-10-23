/**
 * The Mimir Feedback tab: each video with feedback and its counts of thumbs, a
 * page at a time. Assessments Administrators can also edit, accept and ignore comments.
 */

import { auth } from "@/auth";
import { canManageEvalsSettings } from "@/lib/roles";
import { VIDEO_FEEDBACK_SUMMARY_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listVideoFeedbackSummary } from "@/lib/video-feedback";
import { FeedbackView } from "./feedback-view";

export default async function MimirFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, VIDEO_FEEDBACK_SUMMARY_LIST);
  const [page, session] = await Promise.all([listVideoFeedbackSummary(query), auth()]);
  return <FeedbackView query={query} page={page} canModerate={Boolean(session?.user && canManageEvalsSettings(session.user.access))} />;
}

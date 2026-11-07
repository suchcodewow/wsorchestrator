/**
 * The Diagnostic's Feedback: the smiley and confused ratings given while
 * taking a test, with any comment and the question on screen, the newest
 * first, a page at a time; the open ones unless `?closed=1`. Assessments
 * Administrators only.
 */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { WideView } from "@/components/wide-view";
import { listIrisFeedback } from "@/lib/iris/feedback";
import { IRIS_FEEDBACK_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";
import { FeedbackTable } from "./feedback-table";

export default async function DiagnosticFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  const params = await searchParams;
  const query = parseListQuery(params, IRIS_FEEDBACK_LIST);
  const showClosed = params.closed === "1";
  // Comment and question both want room: the table takes the browser's width, not the reading column's.
  return (
    <WideView>
      <FeedbackTable query={query} showClosed={showClosed} page={await listIrisFeedback(query, { closed: showClosed })} />
    </WideView>
  );
}

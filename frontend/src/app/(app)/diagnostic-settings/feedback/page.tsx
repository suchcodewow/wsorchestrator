/**
 * The Diagnostic's Feedback: the smiley and confused ratings given while
 * taking a test, with any comment and the question on screen, the newest
 * first, a page at a time. Assessments Administrators only.
 */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
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

  const query = parseListQuery(await searchParams, IRIS_FEEDBACK_LIST);
  return <FeedbackTable query={query} page={await listIrisFeedback(query)} />;
}

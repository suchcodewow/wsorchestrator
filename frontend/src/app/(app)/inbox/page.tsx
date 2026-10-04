/**
 * My inbox: the checklist items this account owns and everywhere it is
 * tagged, across every bootcamp, each a page at a time. Open to everyone
 * signed in, since a guest judge holds no Training role yet can own and be
 * tagged.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { MY_CHECKLIST_LIST, MY_MENTION_LIST, isChecklistStatus } from "@/lib/list-specs";
import { listMyMentions, myMentionCount } from "@/lib/mention-store";
import { parseListQuery } from "@/lib/paging";
import { canScoreAssessments, canUseTraining } from "@/lib/roles";
import { activeBootcamp } from "@/lib/scheduler/bootcamps";
import { listMyChecklist, myOpenChecklistCount } from "@/lib/scheduler/checklist";
import { InboxView } from "./inbox-view";

export const metadata: Metadata = { title: "My inbox" };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const params = await searchParams;
  const email = session.user.email ?? null;
  const viewer = { email, access: session.user.access };
  const itemQuery = parseListQuery(params, MY_CHECKLIST_LIST, "items");
  const mentionQuery = parseListQuery(params, MY_MENTION_LIST, "mentions");
  // A hand-typed status that isn't one shows what is still open, as the API does.
  const status = isChecklistStatus(params.status) ? params.status : "open";
  const canScore = canScoreAssessments(session.user.access);
  const [items, open, mentions, mentionTotal, active] = await Promise.all([
    listMyChecklist(email, status, itemQuery),
    myOpenChecklistCount(email),
    listMyMentions(viewer, mentionQuery),
    myMentionCount(viewer),
    canScore ? activeBootcamp() : null,
  ]);

  return (
    <InboxView
      itemQuery={itemQuery}
      mentionQuery={mentionQuery}
      status={status}
      items={items}
      open={open}
      mentions={mentions}
      mentionTotal={mentionTotal}
      viewerEmail={email ?? ""}
      canOpenSchedules={canUseTraining(session.user.access)}
      scoringBootcampId={active?.id ?? null}
    />
  );
}

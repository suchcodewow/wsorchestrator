/** The Previous tab: each day BTC or INT was held, newest first, a page at a time; a day opens to who attended. */

import { auth } from "@/auth";
import { listPreviousSessions, previousSessionsSummary } from "@/lib/evals/bootcamp-history";
import { PREVIOUS_SESSION_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canUseEvals } from "@/lib/roles";
import { PreviousView } from "./previous-view";

export default async function PreviousCohortsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, PREVIOUS_SESSION_LIST);
  const [session, page, summary] = await Promise.all([auth(), listPreviousSessions(query), previousSessionsSummary()]);
  return (
    <PreviousView
      query={query}
      page={page}
      total={summary.sessions}
      first={summary.first}
      canOpenHistory={session?.user ? canUseEvals(session.user.access) : false}
    />
  );
}

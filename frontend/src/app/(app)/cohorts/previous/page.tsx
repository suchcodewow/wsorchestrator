/**
 * The Previous tab: each day BTC or INT was held, newest first, a page at a
 * time; a day opens to who attended. The days the URL names as open arrive
 * already open, so coming back to the tab finds it as it was left.
 */

import { getSessionDetail, listPreviousSessions, previousSessionsSummary } from "@/lib/evals/previous-sessions";
import { PREVIOUS_SESSION_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { OPEN_PARAM, parseOpen } from "./open";
import { PreviousView } from "./previous-view";

export default async function PreviousCohortsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseListQuery(params, PREVIOUS_SESSION_LIST);
  const [page, summary, opened] = await Promise.all([
    listPreviousSessions(query),
    previousSessionsSummary(),
    Promise.all(parseOpen(params[OPEN_PARAM]).map((date) => getSessionDetail(date, { bootcamp: 1, intermediate: 1 }))),
  ]);
  return (
    <PreviousView query={query} page={page} total={summary.sessions} first={summary.first} opened={opened.filter((d) => d !== null)} />
  );
}

/** The Dietary needs tab: everyone registered, those with dietary needs first, then who has yet to register. */

import { DIETARY_LIST, UNREGISTERED_LIST, UNREGISTERED_PREFIX } from "@/lib/list-specs";
import { dietaryCounts, listDietaryNeeds, listUnregistered } from "@/lib/logistics/responses";
import { parseListQuery } from "@/lib/paging";
import { DietaryView } from "./dietary-view";

export default async function DietaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseListQuery(params, DIETARY_LIST);
  const unregisteredQuery = parseListQuery(params, UNREGISTERED_LIST, UNREGISTERED_PREFIX);
  const [page, counts, unregistered] = await Promise.all([
    listDietaryNeeds(query),
    dietaryCounts(),
    listUnregistered(unregisteredQuery),
  ]);
  return (
    <DietaryView
      query={query}
      page={page}
      counts={counts}
      unregisteredQuery={unregisteredQuery}
      unregistered={unregistered}
    />
  );
}

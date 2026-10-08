/** The Dietary needs tab: attendees' dietary needs from the intake form, the most critical first. */

import { DIETARY_LIST } from "@/lib/list-specs";
import { dietaryCounts, listDietaryNeeds } from "@/lib/logistics/responses";
import { parseListQuery } from "@/lib/paging";
import { DietaryView } from "./dietary-view";

export default async function DietaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, DIETARY_LIST);
  const [page, counts] = await Promise.all([listDietaryNeeds(query), dietaryCounts()]);
  return <DietaryView query={query} page={page} counts={counts} />;
}

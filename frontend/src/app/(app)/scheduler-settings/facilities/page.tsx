/** The Facilities tab: the places bootcamps are held and their rooms, a page at a time. */

import { FACILITY_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listFacilities } from "@/lib/scheduler/facilities";
import { FacilitiesView } from "./facilities-view";

export default async function FacilitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, FACILITY_LIST);
  const page = await listFacilities(query);
  return (
    <FacilitiesView query={query} page={{ ...page, rows: page.rows.map((f) => ({ ...f, updatedAt: f.updatedAt.toISOString() })) }} />
  );
}

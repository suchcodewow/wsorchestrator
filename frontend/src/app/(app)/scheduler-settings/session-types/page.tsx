/** The Session types tab: the quick starts for a new session, in the order the session dialog offers them. */

import { SESSION_TYPE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listSessionTypes } from "@/lib/scheduler/session-types";
import { SessionTypesView } from "./session-types-view";

export default async function SessionTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, SESSION_TYPE_LIST);
  return <SessionTypesView query={query} page={await listSessionTypes(query)} />;
}

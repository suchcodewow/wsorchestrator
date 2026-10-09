/** The recording link to share, and every take recorded through it, the newest first. */

import { RECORDING_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listTakes } from "@/lib/recording/recordings";
import { RecordingsView } from "./recordings-view";

export const dynamic = "force-dynamic";

export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, RECORDING_LIST);
  return <RecordingsView query={query} page={await listTakes(query)} />;
}

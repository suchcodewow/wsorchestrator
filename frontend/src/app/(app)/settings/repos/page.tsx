/** The GitHub repositories page, a page of them at a time. */

import { listRepos } from "@/lib/harness-repos";
import { REPO_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { ReposView } from "./repos-view";

export default async function ReposPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, REPO_LIST);
  return <ReposView query={query} page={await listRepos(query)} />;
}

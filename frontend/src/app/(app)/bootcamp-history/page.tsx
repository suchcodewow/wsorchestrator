/** Bootcamp History: everyone with a BTC or INT record, newest bootcamp first, a page at a time. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { historyCounts, listHistoryPage } from "@/lib/evals/bootcamp-history";
import { BOOTCAMP_HISTORY_LIST, isHistoryStatus } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canUseEvals } from "@/lib/roles";
import { HistoryTable } from "./history-table";

export const metadata: Metadata = { title: "Bootcamp History" };

export default async function BootcampHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseEvals(session.user.access)) notFound();

  const params = await searchParams;
  const query = parseListQuery(params, BOOTCAMP_HISTORY_LIST);
  // A hand-typed status that isn't one shows everyone, as a bad sort does.
  const status = isHistoryStatus(params.status) ? params.status : null;
  const [page, counts] = await Promise.all([listHistoryPage(query, status), historyCounts()]);
  return <HistoryTable query={query} status={status} page={page} counts={counts} />;
}

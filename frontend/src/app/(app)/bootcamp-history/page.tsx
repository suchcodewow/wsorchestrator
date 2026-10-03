/** Bootcamp History: everyone with a BTC or INT record, by name and email, a page at a time. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { historyCount, listHistoryPage } from "@/lib/evals/bootcamp-history";
import { BOOTCAMP_HISTORY_LIST } from "@/lib/list-specs";
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

  const query = parseListQuery(await searchParams, BOOTCAMP_HISTORY_LIST);
  const [page, count] = await Promise.all([listHistoryPage(query), historyCount()]);
  return <HistoryTable query={query} page={page} count={count} />;
}

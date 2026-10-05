/** One person's bootcamp history: every column of their row, and who they are from the employee list. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth, signInPath } from "@/auth";
import { getHistoryDetail } from "@/lib/evals/bootcamp-history";
import { BOOTCAMP_HISTORY_LIST, isHistoryStatus } from "@/lib/list-specs";
import { parseListQuery, withParams, writeListQuery } from "@/lib/paging";
import { canUseEvals } from "@/lib/roles";
import { HistoryDetailView } from "./history-detail-view";

export const metadata: Metadata = { title: "Bootcamp History" };

const idSchema = z.string().uuid();

export default async function HistoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseEvals(session.user.access)) notFound();

  const id = idSchema.safeParse((await params).id);
  const detail = id.success ? await getHistoryDetail(id.data) : null;
  if (!detail) notFound();

  // The list carried its search, sort, page and status here, so the back link returns to them.
  const list = await searchParams;
  const back = writeListQuery(parseListQuery(list, BOOTCAMP_HISTORY_LIST), BOOTCAMP_HISTORY_LIST);
  if (isHistoryStatus(list.status)) back.set("status", list.status);

  return (
    <HistoryDetailView
      detail={{ ...detail, createdAt: detail.createdAt.toISOString(), updatedAt: detail.updatedAt.toISOString() }}
      back={{ href: withParams("/reporting/bootcamp-history", back), label: "Bootcamp History" }}
      nested
    />
  );
}

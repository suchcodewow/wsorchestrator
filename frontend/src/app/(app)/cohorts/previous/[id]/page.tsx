/**
 * One attendee's bootcamp history, opened from the Previous tab: the same
 * record as Bootcamp History's, but kept under Cohorts, with its back link to
 * the tab as it was left. Scores are eVals data, so it needs an Assessments Viewer
 * as well as the Cohorts layout's Training Viewer.
 */

import { notFound } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { getHistoryDetail } from "@/lib/evals/bootcamp-history";
import { canUseEvals } from "@/lib/roles";
import { HistoryDetailView } from "../../../reporting/bootcamp-history/[id]/history-detail-view";
import { previousHref } from "../open";

const idSchema = z.string().uuid();

export default async function PreviousAttendeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user || !canUseEvals(session.user.access)) notFound();

  const id = idSchema.safeParse((await params).id);
  const detail = id.success ? await getHistoryDetail(id.data) : null;
  if (!detail) notFound();

  return (
    <HistoryDetailView
      detail={{ ...detail, createdAt: detail.createdAt.toISOString(), updatedAt: detail.updatedAt.toISOString() }}
      back={{ href: previousHref(await searchParams), label: "Previous" }}
      nested
    />
  );
}

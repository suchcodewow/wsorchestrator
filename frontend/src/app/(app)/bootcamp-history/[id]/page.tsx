/** One person's bootcamp history: every column of their row, and who they are from the employee list. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth, signInPath } from "@/auth";
import { getHistoryDetail } from "@/lib/evals/bootcamp-history";
import { canUseEvals } from "@/lib/roles";
import { HistoryDetailView } from "./history-detail-view";

export const metadata: Metadata = { title: "Bootcamp History" };

const idSchema = z.string().uuid();

export default async function HistoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseEvals(session.user.access)) notFound();

  const id = idSchema.safeParse((await params).id);
  const detail = id.success ? await getHistoryDetail(id.data) : null;
  if (!detail) notFound();

  return (
    <HistoryDetailView
      detail={{ ...detail, createdAt: detail.createdAt.toISOString(), updatedAt: detail.updatedAt.toISOString() }}
    />
  );
}

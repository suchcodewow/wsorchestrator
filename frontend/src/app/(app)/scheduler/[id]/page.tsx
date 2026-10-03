/** One bootcamp and its guest judges, a page at a time. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth, signInPath } from "@/auth";
import { JUDGE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { getBootcamp } from "@/lib/scheduler/bootcamps";
import { listJudges } from "@/lib/scheduler/judges";
import { JudgesView } from "./judges-view";

export const metadata: Metadata = { title: "Bootcamp" };

export default async function BootcampPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  const id = z.string().uuid().safeParse((await params).id);
  const bootcamp = id.success ? await getBootcamp(id.data) : null;
  if (!bootcamp) notFound();

  const query = parseListQuery(await searchParams, JUDGE_LIST);
  const page = await listJudges(bootcamp.id, query);

  return (
    <JudgesView
      bootcamp={{ ...bootcamp, createdAt: bootcamp.createdAt.toISOString() }}
      query={query}
      page={{ ...page, rows: page.rows.map((j) => ({ ...j, addedAt: j.addedAt.toISOString() })) }}
      canManage={canManageTrainingSettings(session.user.access)}
    />
  );
}

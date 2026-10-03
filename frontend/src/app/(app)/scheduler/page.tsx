/** The scheduler: the bootcamps planned, a page at a time. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { BOOTCAMP_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { activeBootcamp, listBootcamps } from "@/lib/scheduler/bootcamps";
import { SchedulerView } from "./scheduler-view";

export const metadata: Metadata = { title: "Scheduler" };

export default async function SchedulerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  const query = parseListQuery(await searchParams, BOOTCAMP_LIST);
  const [page, active] = await Promise.all([listBootcamps(query), activeBootcamp()]);

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Scheduler</h1>
      <SchedulerView
        query={query}
        page={page}
        active={active}
        canManage={canManageTrainingSettings(session.user.access)}
      />
    </div>
  );
}

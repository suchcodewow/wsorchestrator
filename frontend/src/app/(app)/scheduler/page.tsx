/** The scheduler: the bootcamps planned, a page at a time. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { BOOTCAMP_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { listBootcamps } from "@/lib/scheduler/bootcamps";
import { facilityPicks } from "@/lib/scheduler/facilities";
import { copySources } from "@/lib/scheduler/schedule";
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

  const params = await searchParams;
  const query = parseListQuery(params, BOOTCAMP_LIST);
  const showComplete = params.complete === "1";
  const canManage = canManageTrainingSettings(session.user.access);
  const [page, facilities, sources] = await Promise.all([
    listBootcamps(query, showComplete),
    canManage ? facilityPicks() : [],
    canManage ? copySources(null) : [],
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Scheduler</h1>
      <SchedulerView
        query={query}
        showComplete={showComplete}
        page={page}
        canManage={canManage}
        facilities={facilities}
        sources={sources}
      />
    </div>
  );
}

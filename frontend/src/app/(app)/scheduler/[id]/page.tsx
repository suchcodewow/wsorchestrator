/** One bootcamp's schedule: its four tracks, day by day, to rearrange and staff. */

import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { z } from "zod";
import { auth, signInPath } from "@/auth";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { checklistCounts } from "@/lib/scheduler/checklist";
import { facilityPicks } from "@/lib/scheduler/facilities";
import { parseScheduleCondensed, parseScheduleView, SCHEDULE_CONDENSED_COOKIE, SCHEDULE_VIEW_COOKIE } from "@/lib/scheduler/schedule-prefs";
import { copySources, loadSchedule } from "@/lib/scheduler/schedule";
import { allSessionTypes } from "@/lib/scheduler/session-types";
import { ScheduleView } from "./schedule-view";

export const metadata: Metadata = { title: "Schedule" };

const idSchema = z.string().uuid();

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  const id = idSchema.safeParse((await params).id);
  const schedule = id.success ? await loadSchedule(id.data) : null;
  if (!schedule) notFound();

  const canManage = canManageTrainingSettings(session.user.access);
  const [types, sources, checklist, facilities, cookieJar] = await Promise.all([
    canManage ? allSessionTypes() : [],
    canManage ? copySources(schedule.bootcamp.id) : [],
    checklistCounts(schedule.bootcamp.id),
    canManage ? facilityPicks() : [],
    cookies(),
  ]);
  const initialView = parseScheduleView(cookieJar.get(SCHEDULE_VIEW_COOKIE)?.value);
  const initialCondensed = parseScheduleCondensed(cookieJar.get(SCHEDULE_CONDENSED_COOKIE)?.value);

  const { bootcamp } = schedule;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/scheduler"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Scheduler
        </Link>
        <h1 className="text-3xl font-medium tracking-tight">
          {MONTH_YEAR.format(new Date(`${bootcamp.startDate}T00:00:00Z`))} Bootcamp
        </h1>
      </div>
      <ScheduleView initial={schedule} types={types} sources={sources} facilities={facilities} canManage={canManage}
        viewerId={session.user.id}
        viewerEmail={session.user.email ?? ""}
        checklist={checklist}
        initialView={initialView}
        initialCondensed={initialCondensed}
      />
    </div>
  );
}

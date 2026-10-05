/**
 * The page around one bootcamp's schedule, once it is loaded: shown at
 * /scheduler/{id}, and at /scheduler/active for whichever bootcamp is active.
 */

import { cookies } from "next/headers";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { canManageTrainingSettings, type Access } from "@/lib/roles";
import { checklistCounts } from "@/lib/scheduler/checklist";
import { facilityPicks } from "@/lib/scheduler/facilities";
import { parseScheduleCondensed, parseScheduleView, SCHEDULE_CONDENSED_COOKIE, SCHEDULE_VIEW_COOKIE } from "@/lib/scheduler/schedule-prefs";
import { copySources, type Schedule } from "@/lib/scheduler/schedule";
import { allSessionTypes } from "@/lib/scheduler/session-types";
import { ScheduleView } from "./schedule-view";

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export async function SchedulePage({
  schedule,
  viewer,
}: {
  schedule: Schedule;
  viewer: { id: string; email: string; access: Access };
}) {
  const canManage = canManageTrainingSettings(viewer.access);
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
        <BackToScheduler />
        <h1 className="text-3xl font-medium tracking-tight">
          {MONTH_YEAR.format(new Date(`${bootcamp.startDate}T00:00:00Z`))} Bootcamp
        </h1>
      </div>
      <ScheduleView initial={schedule} types={types} sources={sources} facilities={facilities} canManage={canManage}
        viewerId={viewer.id}
        viewerEmail={viewer.email}
        checklist={checklist}
        initialView={initialView}
        initialCondensed={initialCondensed}
      />
    </div>
  );
}

export function BackToScheduler() {
  return (
    <Link
      href="/scheduler"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      Scheduler
    </Link>
  );
}

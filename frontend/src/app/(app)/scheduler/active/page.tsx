/**
 * A permalink to the active bootcamp's schedule: the same page as
 * /scheduler/{id}, for whichever bootcamp is active when it loads, so a
 * bookmark or a tab left open follows the Scheduler from one to the next.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canUseTraining } from "@/lib/roles";
import { activeBootcamp } from "@/lib/scheduler/bootcamps";
import { loadSchedule } from "@/lib/scheduler/schedule";
import { BackToScheduler, SchedulePage } from "../[id]/schedule-page";

export const metadata: Metadata = { title: "Schedule" };

export default async function ActiveSchedulePage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  const active = await activeBootcamp();
  const schedule = active ? await loadSchedule(active.id) : null;
  if (!schedule) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <BackToScheduler />
          <h1 className="text-3xl font-medium tracking-tight">Active bootcamp</h1>
        </div>
        <div className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground shadow-sm">
          No bootcamp is active. Set one to Active in the Scheduler and its schedule shows here.
        </div>
      </div>
    );
  }

  return (
    <SchedulePage
      schedule={schedule}
      viewer={{ id: session.user.id, email: session.user.email ?? "", access: session.user.access }}
    />
  );
}

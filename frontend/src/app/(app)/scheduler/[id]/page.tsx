/** One bootcamp's schedule: its four tracks, day by day, to rearrange and staff. */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { z } from "zod";
import { auth, signInPath } from "@/auth";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { checklistCounts } from "@/lib/scheduler/checklist";
import { copySources, loadSchedule } from "@/lib/scheduler/schedule";
import { allSessionTypes } from "@/lib/scheduler/session-types";
import { formatDate } from "../../cohort-settings/format";
import { ScheduleView } from "./schedule-view";

export const metadata: Metadata = { title: "Schedule" };

const idSchema = z.string().uuid();

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  const id = idSchema.safeParse((await params).id);
  const schedule = id.success ? await loadSchedule(id.data) : null;
  if (!schedule) notFound();

  const canManage = canManageTrainingSettings(session.user.access);
  const [types, sources, checklist] = await Promise.all([
    canManage ? allSessionTypes() : [],
    canManage ? copySources(schedule.bootcamp.id) : [],
    checklistCounts(schedule.bootcamp.id),
  ]);

  const { bootcamp } = schedule;
  const facts = [
    bootcamp.facilityName ?? "No facility picked",
    `Bootcamp ${bootcamp.btcDays} day${bootcamp.btcDays === 1 ? "" : "s"}`,
    bootcamp.intDays ? `Intermediate ${bootcamp.intDays} day${bootcamp.intDays === 1 ? "" : "s"}` : "No Intermediate",
  ];

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
        <h1 className="text-3xl font-medium tracking-tight">Bootcamp starting {formatDate(bootcamp.startDate)}</h1>
        <p className="text-sm text-muted-foreground">{facts.join(" · ")}</p>
      </div>
      <ScheduleView initial={schedule} types={types} sources={sources} canManage={canManage}
        viewerId={session.user.id}
        viewerEmail={session.user.email ?? ""}
        checklist={checklist}
      />
    </div>
  );
}

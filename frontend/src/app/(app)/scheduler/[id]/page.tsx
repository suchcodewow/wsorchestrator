/** One bootcamp's schedule: its four tracks, day by day, to rearrange and staff. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth, signInPath } from "@/auth";
import { canUseTraining } from "@/lib/roles";
import { loadSchedule } from "@/lib/scheduler/schedule";
import { SchedulePage } from "./schedule-page";

export const metadata: Metadata = { title: "Schedule" };

const idSchema = z.string().uuid();

export default async function BootcampSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  const id = idSchema.safeParse((await params).id);
  const schedule = id.success ? await loadSchedule(id.data) : null;
  if (!schedule) notFound();

  return (
    <SchedulePage
      schedule={schedule}
      viewer={{ id: session.user.id, email: session.user.email ?? "", access: session.user.access }}
    />
  );
}

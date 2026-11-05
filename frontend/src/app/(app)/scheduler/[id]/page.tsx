/** One bootcamp's schedule: its four tracks, day by day, to rearrange and staff. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth, signInPath } from "@/auth";
import { canSeeScheduler } from "@/lib/roles";
import { mayReadBootcamp } from "@/lib/scheduler/judging";
import { loadSchedule } from "@/lib/scheduler/schedule";
import { SchedulePage } from "./schedule-page";

export const metadata: Metadata = { title: "Schedule" };

const idSchema = z.string().uuid();

export default async function BootcampSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canSeeScheduler(session.user.access)) notFound();

  const id = idSchema.safeParse((await params).id);
  const readable = id.success && (await mayReadBootcamp(session.user.access, id.data));
  const schedule = readable ? await loadSchedule(id.data) : null;
  if (!schedule) notFound();

  return (
    <SchedulePage
      schedule={schedule}
      viewer={{ id: session.user.id, email: session.user.email ?? "", access: session.user.access }}
    />
  );
}

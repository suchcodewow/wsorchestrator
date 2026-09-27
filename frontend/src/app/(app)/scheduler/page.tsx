/** The scheduler. A placeholder until its functions are specified. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { auth, signInPath } from "@/auth";
import { ComingSoon } from "@/components/coming-soon";
import { canUseScheduler } from "@/lib/roles";

export const metadata: Metadata = { title: "Scheduler" };

export default async function SchedulerPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseScheduler(session.user.access)) notFound();

  return (
    <ComingSoon
      title="Scheduler"
      description="Visible to scheduler viewers and administrators."
      Icon={CalendarClock}
    />
  );
}

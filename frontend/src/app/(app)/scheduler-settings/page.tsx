/**
 * The scheduler's settings. A placeholder until its functions are specified.
 *
 * A sibling of /scheduler rather than beneath it, so the sidebar does not
 * light up both entries at once.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CalendarCog } from "lucide-react";
import { auth, signInPath } from "@/auth";
import { ComingSoon } from "@/components/coming-soon";
import { canManageSchedulerSettings } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Scheduler settings",
  robots: { index: false, follow: false },
};

export default async function SchedulerSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageSchedulerSettings(session.user.access)) notFound();

  return (
    <ComingSoon title="Scheduler settings" Icon={CalendarCog} />
  );
}

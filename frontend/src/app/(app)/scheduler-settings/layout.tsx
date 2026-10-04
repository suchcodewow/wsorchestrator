/**
 * The layout for Scheduler settings.
 *
 * A sibling of /scheduler rather than beneath it, so the sidebar does not
 * light up both entries at once.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageTrainingSettings } from "@/lib/roles";
import { SchedulerSettingsTabs } from "./scheduler-settings-tabs";

export const metadata: Metadata = {
  title: "Scheduler settings",
  robots: { index: false, follow: false },
};

export default async function SchedulerSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageTrainingSettings(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Scheduler settings</h1>

      <SchedulerSettingsTabs />

      {children}
    </div>
  );
}

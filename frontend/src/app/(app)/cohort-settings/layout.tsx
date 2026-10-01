/**
 * The layout for Cohort Settings: where attendees come from and how they are
 * sorted.
 *
 * A sibling of /cohorts rather than beneath it, so the sidebar does not light
 * up both entries at once.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageTrainingSettings } from "@/lib/roles";
import { CohortSettingsTabs } from "./cohort-settings-tabs";

export const metadata: Metadata = {
  title: "Cohort Settings",
  robots: { index: false, follow: false },
};

export default async function CohortSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageTrainingSettings(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Cohort Settings</h1>

      <CohortSettingsTabs access={session.user.access} />

      {children}
    </div>
  );
}

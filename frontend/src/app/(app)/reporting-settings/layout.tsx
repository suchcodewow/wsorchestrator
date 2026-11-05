/**
 * The layout for Reporting Settings: releasing each class's feedback to
 * managers, and the Canary Wire's settings.
 *
 * A sibling of /reporting rather than beneath it, so the sidebar does not
 * light up both entries at once.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageBootcampRecords } from "@/lib/roles";
import { ReportingSettingsTabs } from "./reporting-settings-tabs";

export const metadata: Metadata = {
  title: "Reporting Settings",
  robots: { index: false, follow: false },
};

export default async function ReportingSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageBootcampRecords(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Reporting Settings</h1>

      <ReportingSettingsTabs />

      {children}
    </div>
  );
}

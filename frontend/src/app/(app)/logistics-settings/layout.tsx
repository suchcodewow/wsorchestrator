/**
 * The layout for Logistics settings.
 *
 * A sibling of /logistics rather than beneath it, so the sidebar does not
 * light up both entries at once.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageTrainingSettings } from "@/lib/roles";
import { LogisticsSettingsTabs } from "./logistics-settings-tabs";

export const metadata: Metadata = {
  title: "Logistics settings",
  robots: { index: false, follow: false },
};

export default async function LogisticsSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageTrainingSettings(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Logistics settings</h1>

      <LogisticsSettingsTabs />

      {children}
    </div>
  );
}

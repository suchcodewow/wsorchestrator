/**
 * The layout for eVals settings: where attendees come from and how they are
 * sorted.
 *
 * A sibling of /evals rather than beneath it, so the sidebar does not light up
 * both entries at once.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageEvalsSettings } from "@/lib/roles";
import { EvalsSettingsTabs } from "./evals-settings-tabs";

export const metadata: Metadata = {
  title: "eVals settings",
  robots: { index: false, follow: false },
};

export default async function EvalsSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageEvalsSettings(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">eVals settings</h1>
        <p className="text-muted-foreground">
          Where eVals attendees come from and how they are sorted, visible only
          to eVals administrators.
        </p>
      </div>

      <EvalsSettingsTabs access={session.user.access} />

      {children}
    </div>
  );
}

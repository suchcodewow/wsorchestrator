/**
 * The layout for Diagnostic Settings, for Assessments Administrators.
 *
 * A sibling of /diagnostic rather than beneath it: the tests there are for
 * Participants only, and an administrator need not be one.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageIris } from "@/lib/roles";
import { DiagnosticSettingsTabs } from "./diagnostic-settings-tabs";

export const metadata: Metadata = {
  title: "Diagnostic Settings",
  robots: { index: false, follow: false },
};

export default async function DiagnosticSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Diagnostic Settings</h1>
      <DiagnosticSettingsTabs />
      {children}
    </div>
  );
}

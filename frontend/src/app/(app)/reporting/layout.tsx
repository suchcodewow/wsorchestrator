/** The layout for Reporting: open to eVals Viewers and above, and to whoever may see the Canary Wire. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canSeeReporting } from "@/lib/roles";
import { ReportingTabs } from "./reporting-tabs";

export const metadata: Metadata = { title: "Reporting" };

export default async function ReportingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canSeeReporting(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Reporting</h1>

      <ReportingTabs access={session.user.access} />

      {children}
    </div>
  );
}

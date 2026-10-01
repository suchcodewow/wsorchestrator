/**
 * The layout for eVals settings.
 *
 * A sibling of /evals rather than beneath it, so the sidebar does not light up
 * both entries at once.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageEvalsSettings } from "@/lib/roles";

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
      <h1 className="text-3xl font-medium tracking-tight">eVals settings</h1>

      {children}
    </div>
  );
}

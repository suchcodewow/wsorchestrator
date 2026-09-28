/**
 * eVals settings. A placeholder until its functions are specified.
 *
 * A sibling of /evals rather than beneath it, so the sidebar does not light up
 * both entries at once.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TestTubes } from "lucide-react";
import { auth, signInPath } from "@/auth";
import { ComingSoon } from "@/components/coming-soon";
import { canManageEvalsSettings } from "@/lib/roles";

export const metadata: Metadata = {
  title: "eVals settings",
  robots: { index: false, follow: false },
};

export default async function EvalsSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageEvalsSettings(session.user.access)) notFound();

  return (
    <ComingSoon
      title="eVals settings"
      description="Configuration for eVals, visible only to eVals administrators."
      Icon={TestTubes}
    />
  );
}

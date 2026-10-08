/**
 * The layout for Mimir Settings, for Training Administrators.
 *
 * A sibling of /mimir rather than beneath it, so the sidebar does not light up
 * both entries at once.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageMimir } from "@/lib/roles";
import { MimirSettingsTabs } from "./mimir-settings-tabs";

export const metadata: Metadata = {
  title: "Mimir Settings",
  robots: { index: false, follow: false },
};

export default async function MimirSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageMimir(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Mimir Settings</h1>
      <MimirSettingsTabs />
      {children}
    </div>
  );
}

/** The layout for Admin Settings: the platform's own configuration, beyond any single area. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageSignInDomains } from "@/lib/roles";
import { AdminSettingsTabs } from "./admin-settings-tabs";

export default async function AdminSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageSignInDomains(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Admin Settings</h1>

      <AdminSettingsTabs />

      {children}
    </div>
  );
}

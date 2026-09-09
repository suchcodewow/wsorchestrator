/** The layout for site settings, the deployment's own configuration. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageSettings } from "@/lib/roles";
import { SiteSettingsTabs } from "./settings-tabs";

export default async function SiteSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageSettings(session.user.siteRole)) notFound();

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Site-wide configuration, visible only to administrators.
        </p>
      </div>

      <SiteSettingsTabs />

      {children}
    </div>
  );
}

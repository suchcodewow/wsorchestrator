/** The layout for event settings, the configuration events run with. */

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
  if (!canManageSettings(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Event Settings</h1>

      <SiteSettingsTabs access={session.user.access} />

      {children}
    </div>
  );
}

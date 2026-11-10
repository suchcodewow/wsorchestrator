/**
 * The layout for Games settings.
 *
 * A sibling of /games rather than beneath it, so the sidebar does not light
 * up both entries at once.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageTrainingSettings } from "@/lib/roles";
import { GamesSettingsTabs } from "./games-settings-tabs";

export const metadata: Metadata = {
  title: "Games settings",
  robots: { index: false, follow: false },
};

export default async function GamesSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageTrainingSettings(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Games settings</h1>

      <GamesSettingsTabs />

      {children}
    </div>
  );
}

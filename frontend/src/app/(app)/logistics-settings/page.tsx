/** Sends /logistics-settings to its first tab. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageTrainingSettings } from "@/lib/roles";
import { LOGISTICS_SETTINGS_TABS } from "./tabs";

export default async function LogisticsSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageTrainingSettings(session.user.access)) notFound();

  redirect(LOGISTICS_SETTINGS_TABS[0]!.href);
}

/** Sends /scheduler-settings to its first tab. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageTrainingSettings } from "@/lib/roles";
import { SCHEDULER_SETTINGS_TABS } from "./tabs";

export default async function SchedulerSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageTrainingSettings(session.user.access)) notFound();

  redirect(SCHEDULER_SETTINGS_TABS[0]!.href);
}

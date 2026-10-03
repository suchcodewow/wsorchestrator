/** Sends /evals-settings to its first tab. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageEvalsSettings } from "@/lib/roles";
import { EVALS_SETTINGS_TABS } from "./tabs";

export default async function EvalsSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageEvalsSettings(session.user.access)) notFound();

  redirect(EVALS_SETTINGS_TABS[0]!.href);
}

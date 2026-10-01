/** Sends /cohort-settings to the first tab the viewer can see. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { visibleCohortSettingsTabs } from "./tabs";

export default async function CohortSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  redirect(visibleCohortSettingsTabs(session.user.access)[0]!.href);
}

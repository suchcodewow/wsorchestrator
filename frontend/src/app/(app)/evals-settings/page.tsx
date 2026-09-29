/** Sends /evals-settings to the first tab the viewer can see. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { visibleEvalsSettingsTabs } from "./tabs";

export default async function EvalsSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  redirect(visibleEvalsSettingsTabs(session.user.access)[0]!.href);
}

/** Sends /settings to the first tab the viewer can see. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { visibleSettingsTabs } from "./tabs";

export default async function SiteSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  redirect(visibleSettingsTabs(session.user.access)[0]!.href);
}

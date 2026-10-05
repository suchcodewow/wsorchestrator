/** Sends /me to the first tab the viewer can see. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { visibleMySettingsTabs } from "./tabs";

export default async function MySettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  redirect(visibleMySettingsTabs(session.user.access)[0]!.href);
}

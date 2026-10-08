/** Sends /mimir-settings to its first tab. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageMimir } from "@/lib/roles";
import { MIMIR_SETTINGS_TABS } from "./tabs";

export default async function MimirSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageMimir(session.user.access)) notFound();

  redirect(MIMIR_SETTINGS_TABS[0]!.href);
}

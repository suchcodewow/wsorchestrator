/** Sends /reporting-settings to its first tab. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageBootcampRecords } from "@/lib/roles";
import { REPORTING_SETTINGS_TABS } from "./tabs";

export default async function ReportingSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageBootcampRecords(session.user.access)) notFound();

  redirect(REPORTING_SETTINGS_TABS[0]!.href);
}

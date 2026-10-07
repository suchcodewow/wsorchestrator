/** Sends /reporting to the first tab the caller can see. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canSeeReporting } from "@/lib/roles";
import { visibleReportingTabs } from "./tabs";

export default async function ReportingPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canSeeReporting(session.user.access)) notFound();

  redirect(visibleReportingTabs(session.user.access)[0]!.href);
}

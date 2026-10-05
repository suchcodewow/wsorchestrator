/** Sends /reporting to its first tab. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canUseEvals } from "@/lib/roles";
import { REPORTING_TABS } from "./tabs";

export default async function ReportingPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseEvals(session.user.access)) notFound();

  redirect(REPORTING_TABS[0]!.href);
}

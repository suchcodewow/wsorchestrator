/** Sends /cohorts to its first tab. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canSeeCurrentCohort } from "@/lib/roles";
import { COHORTS_TABS } from "./tabs";

export default async function CohortsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canSeeCurrentCohort(session.user.access)) notFound();

  redirect(COHORTS_TABS[0]!.href);
}

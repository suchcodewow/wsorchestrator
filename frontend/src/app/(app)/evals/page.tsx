/** Sends /evals to its first tab. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canScoreAssessments } from "@/lib/roles";
import { EVALS_TABS } from "./tabs";

export default async function EvalsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canScoreAssessments(session.user.access)) notFound();

  redirect(EVALS_TABS[0]!.href);
}

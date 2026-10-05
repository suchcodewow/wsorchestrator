/** The layout for Cohorts: who is in them, one tab per view. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { CURRENT_TRACKS, currentCohortSummary } from "@/lib/evals/current-cohort";
import { canUseTraining } from "@/lib/roles";
import { CohortsTabs } from "./cohorts-tabs";

export const metadata: Metadata = { title: "Cohorts" };

export default async function CohortsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  // Everyone the Current tab lists, bootcamp and intermediate, whatever its filter.
  const { counts } = await currentCohortSummary();
  const currentCount = CURRENT_TRACKS.reduce((n, t) => n + counts.bootcamp[t] + counts.intermediate[t], 0);

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Cohorts</h1>

      <CohortsTabs currentCount={currentCount} />

      {children}
    </div>
  );
}

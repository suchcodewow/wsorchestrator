/** The layout for Cohorts: who is in them, one tab per view. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canUseTraining } from "@/lib/roles";
import { CohortsTabs } from "./cohorts-tabs";

export const metadata: Metadata = { title: "Cohorts" };

export default async function CohortsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Cohorts</h1>

      <CohortsTabs />

      {children}
    </div>
  );
}

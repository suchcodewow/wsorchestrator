/** The layout for eVals: open to Assessments Viewers and above, and to the active bootcamp's guest judges. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canScoreAssessments } from "@/lib/roles";
import { EvalsTabs } from "./evals-tabs";

export const metadata: Metadata = { title: "eVals" };

export default async function EvalsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canScoreAssessments(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">eVals</h1>

      <EvalsTabs />

      {children}
    </div>
  );
}

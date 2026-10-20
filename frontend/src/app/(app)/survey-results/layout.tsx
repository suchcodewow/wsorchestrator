/** The layout for Survey Results: what attendees said in the daily session surveys. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canUseTraining } from "@/lib/roles";

export const metadata: Metadata = { title: "Survey Results" };

export default async function SurveyResultsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  return children;
}

/** Cohorts. A placeholder until its functions are specified. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Users } from "lucide-react";
import { auth, signInPath } from "@/auth";
import { ComingSoon } from "@/components/coming-soon";
import { canUseTraining } from "@/lib/roles";

export const metadata: Metadata = { title: "Cohorts" };

export default async function CohortsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  return (
    <ComingSoon title="Cohorts" Icon={Users} />
  );
}

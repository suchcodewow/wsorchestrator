/** The layout for Logistics: the practical arrangements around a bootcamp, one tab per view. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canUseTraining } from "@/lib/roles";
import { LogisticsTabs } from "./logistics-tabs";

export const metadata: Metadata = { title: "Logistics" };

export default async function LogisticsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Logistics</h1>

      <LogisticsTabs />

      {children}
    </div>
  );
}

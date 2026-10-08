/** The layout for Iris: open to Assessments Viewers and above; the tabs to the console are for Assessments Administrators. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageIris, canTakeIris } from "@/lib/roles";
import { IrisTabs } from "./iris-tabs";

export const metadata: Metadata = { title: "Iris" };

export default async function IrisLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canTakeIris(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Iris</h1>
      {canManageIris(session.user.access) && <IrisTabs />}
      {children}
    </div>
  );
}

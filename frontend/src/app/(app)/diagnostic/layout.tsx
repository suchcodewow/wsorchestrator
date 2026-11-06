/**
 * The layout for Diagnostic: its tests, for Participants. An Assessments
 * Administrator who is not one opens it too, since they can open its
 * settings, and is told no tests are assigned to them.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canSeeIris } from "@/lib/roles";

export const metadata: Metadata = { title: "Diagnostic" };

export default async function IrisLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canSeeIris(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Diagnostic</h1>
      {children}
    </div>
  );
}

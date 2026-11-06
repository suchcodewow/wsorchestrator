/** The layout for Diagnostic: its tests, for Participants and nobody else. Administrators set it up on Diagnostic Settings. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canTakeIris } from "@/lib/roles";

export const metadata: Metadata = { title: "Diagnostic" };

export default async function IrisLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canTakeIris(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Diagnostic</h1>
      {children}
    </div>
  );
}

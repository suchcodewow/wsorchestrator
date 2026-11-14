/** The layout for Presentations: Google Slides decks to present full screen. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canUseTraining } from "@/lib/roles";

export const metadata: Metadata = { title: "Presentations" };

export default async function PresentationsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  return children;
}

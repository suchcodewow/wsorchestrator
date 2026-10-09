/** The layout for Async Recordings: links that let someone outside the company record their camera and screen. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageTrainingSettings } from "@/lib/roles";

export const metadata: Metadata = { title: "Async Recordings" };

export default async function RecordingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageTrainingSettings(session.user.access)) notFound();

  return children;
}

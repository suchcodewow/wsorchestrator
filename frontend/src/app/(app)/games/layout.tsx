/** The layout for Games: live review games a facilitator runs in front of the room, for Training Administrators only. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageTrainingSettings } from "@/lib/roles";
import { GamesTabs } from "./games-tabs";

export const metadata: Metadata = { title: "Games" };

export default async function GamesLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageTrainingSettings(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Games</h1>

      <GamesTabs />

      {children}
    </div>
  );
}

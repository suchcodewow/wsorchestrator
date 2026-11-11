/** Sends /games to its first game. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageTrainingSettings } from "@/lib/roles";
import { GAMES_TABS } from "./tabs";

export default async function GamesPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageTrainingSettings(session.user.access)) notFound();

  redirect(GAMES_TABS[0]!.href);
}

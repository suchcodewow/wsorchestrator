/** Sends /logistics to its first tab. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canUseTraining } from "@/lib/roles";
import { LOGISTICS_TABS } from "./tabs";

export default async function LogisticsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  redirect(LOGISTICS_TABS[0]!.href);
}

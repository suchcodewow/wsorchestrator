/** Sends /mimir to the library. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { MIMIR_TABS } from "./tabs";

export default async function MimirPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  redirect(MIMIR_TABS[0]!.href);
}

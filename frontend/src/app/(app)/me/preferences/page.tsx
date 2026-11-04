/** This account's own preferences: open to every account, since guest judges hold no role. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { PreferencesView } from "./preferences-view";

export default async function PreferencesPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  return <PreferencesView />;
}

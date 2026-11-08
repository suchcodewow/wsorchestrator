/** This account's own preferences: open to every account, since guest judges hold no role. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { chosenNameOnRecord } from "@/lib/evals/chosen-names";
import { PreferencesView } from "./preferences-view";

export default async function PreferencesPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const email = session.user.email;
  const preferred = email ? await chosenNameOnRecord(email) : null;
  return <PreferencesView initialName={preferred ?? ""} />;
}

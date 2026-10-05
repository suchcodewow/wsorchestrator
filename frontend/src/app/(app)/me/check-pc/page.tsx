/** Whether this computer can record an assessment: open to every account, since guest judges hold no role. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { CheckPcView } from "./check-pc-view";

export default async function CheckPcPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  return <CheckPcView viewerId={session.user.id} />;
}

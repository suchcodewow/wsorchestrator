/** Someone's Iris: their track, and each subject to start, continue or that is done; with levels for an Iris administrator. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { myIris } from "@/lib/iris/attempts";
import { canManageIris, canTakeIris } from "@/lib/roles";
import { TestsView } from "./tests-view";

export default async function IrisTestsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canTakeIris(session.user.access)) notFound();

  const admin = canManageIris(session.user.access);
  return <TestsView mine={await myIris(session.user.id, "A", admin)} selfId={admin ? session.user.id : null} />;
}

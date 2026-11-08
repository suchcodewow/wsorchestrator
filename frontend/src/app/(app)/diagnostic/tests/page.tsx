/**
 * Someone's Diagnostic: their track, and each subject to start, continue or
 * that is done. Nobody sees a level, administrators included. An administrator
 * who is not a Participant is told none are assigned to them.
 */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { myIris } from "@/lib/iris/attempts";
import { canManageIris, canSeeIris, canTakeIris } from "@/lib/roles";
import { TestsView } from "./tests-view";

export default async function IrisTestsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canSeeIris(session.user.access)) notFound();

  if (!canTakeIris(session.user.access)) {
    return (
      <p className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground shadow-sm">
        No Tests currently assigned to you.
      </p>
    );
  }

  const admin = canManageIris(session.user.access);
  return <TestsView mine={await myIris(session.user.id, "A")} selfId={admin ? session.user.id : null} />;
}

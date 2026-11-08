/** One Diagnostic subject, a question at a time, for a Participant. An administrator's preview is on Diagnostic Settings. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { SUBJECTS, isSubjectKey } from "@/lib/iris/subjects";
import { canTakeIris } from "@/lib/roles";
import { SittingScreen } from "./sitting-screen";

export default async function IrisSittingPage({ params }: { params: Promise<{ subject: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canTakeIris(session.user.access)) notFound();

  const { subject } = await params;
  if (!isSubjectKey(subject)) notFound();

  return (
    <SittingScreen
      subject={subject}
      name={SUBJECTS[subject].name}
      mode="live"
    />
  );
}

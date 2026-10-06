/** One Iris subject, a question at a time. `?mode=preview` is an Iris administrator trying the questions out. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { SUBJECTS, isSubjectKey } from "@/lib/iris/subjects";
import { canManageIris, canTakeIris } from "@/lib/roles";
import { SittingScreen } from "./sitting-screen";

export default async function IrisSittingPage({
  params,
  searchParams,
}: {
  params: Promise<{ subject: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canTakeIris(session.user.access)) notFound();

  const { subject } = await params;
  if (!isSubjectKey(subject)) notFound();
  const preview = (await searchParams).mode === "preview";
  if (preview && !canManageIris(session.user.access)) notFound();

  return (
    <SittingScreen
      subject={subject}
      name={SUBJECTS[subject].name}
      mode={preview ? "preview" : "live"}
      selfId={canManageIris(session.user.access) ? session.user.id : null}
    />
  );
}

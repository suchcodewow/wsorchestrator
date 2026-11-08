/** One Diagnostic subject tried out by an Assessments Administrator: drafts included, and never recorded. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { SittingScreen } from "@/app/(app)/diagnostic/tests/[subject]/sitting-screen";
import { SUBJECTS, isSubjectKey } from "@/lib/iris/subjects";
import { canManageIris } from "@/lib/roles";

export default async function DiagnosticPreviewPage({ params }: { params: Promise<{ subject: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  const { subject } = await params;
  if (!isSubjectKey(subject)) notFound();

  return (
    <SittingScreen
      subject={subject}
      name={SUBJECTS[subject].name}
      mode="preview"
      backHref={`/diagnostic-settings/questions?subject=${subject}`}
    />
  );
}

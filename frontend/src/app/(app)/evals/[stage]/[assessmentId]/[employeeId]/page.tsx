/** One attendee's scoring form for one assessment at the active bootcamp. */

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth, signInPath } from "@/auth";
import { getScoringForm, scoringAssessment, scoringBootcamp } from "@/lib/evals/scoring";
import { ScoringFormView } from "./scoring-form";

export default async function ScoringPage({
  params,
}: {
  params: Promise<{ stage: string; assessmentId: string; employeeId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const { stage, assessmentId, employeeId } = await params;
  const id = z.string().uuid().safeParse(assessmentId);
  const assessment = id.success ? await scoringAssessment(id.data) : null;
  if (!assessment || assessment.stage !== stage) notFound();

  const bootcamp = await scoringBootcamp(assessment.stage);
  const form = await getScoringForm(assessment.id, employeeId, bootcamp?.id ?? null);
  if (!form) notFound();

  return (
    <ScoringFormView
      form={{
        ...form,
        submission: form.submission && { ...form.submission, updatedAt: form.submission.updatedAt.toISOString() },
        transcripts: form.transcripts.map((t) => ({ ...t, recordedAt: t.recordedAt.toISOString() })),
      }}
      bootcamp={bootcamp}
      viewerId={session.user.id}
    />
  );
}

/**
 * One of the signed-in person's daily surveys: each session they were in
 * that day, then the day as a whole. Someone else's survey, or none, is not
 * found, so no one learns another's survey exists.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { getMySurvey } from "@/lib/surveys/surveys";
import { IntakeShell } from "../../intake-shell";
import { SurveyFiller } from "./survey-form";

export const metadata: Metadata = {
  title: "Daily survey",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const { id } = await params;
  const survey = session.user.email ? await getMySurvey(session.user.email, id) : null;
  if (!survey) notFound();

  return (
    <IntakeShell session={session} back>
      <SurveyFiller survey={survey} />
    </IntakeShell>
  );
}

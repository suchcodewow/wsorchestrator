/**
 * The signed-in person's Bootcamp superlatives survey: a classmate for each
 * superlative. Someone else's survey, or none, is not found, so no one learns
 * another's survey exists.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { getMySuperlatives } from "@/lib/surveys/superlatives";
import { IntakeShell } from "../../intake-shell";
import { SuperlativesFiller } from "./superlatives-form";

export const metadata: Metadata = {
  title: "Bootcamp Superlatives",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SuperlativesPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const { id } = await params;
  const survey = session.user.email ? await getMySuperlatives(session.user.email, id) : null;
  if (!survey) notFound();

  return (
    <IntakeShell session={session} back>
      <SuperlativesFiller survey={survey} />
    </IntakeShell>
  );
}

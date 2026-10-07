/** One person's Iris sittings, question by question, with the answers they chose. Iris administrators only. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { cohortSummary, personDetail } from "@/lib/iris/cohort";
import { canManageIris } from "@/lib/roles";
import { PersonView } from "./person-view";

export default async function IrisPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  const [detail, summary] = await Promise.all([
    personDetail(decodeURIComponent((await params).id), "A"),
    cohortSummary("A"),
  ]);
  if (!detail) notFound();
  return (
    <PersonView
      summary={summary}
      detail={{
        ...detail,
        sittings: detail.sittings.map((s) => ({
          ...s,
          startedAt: s.startedAt.toISOString(),
          finishedAt: s.finishedAt?.toISOString() ?? null,
        })),
      }}
    />
  );
}

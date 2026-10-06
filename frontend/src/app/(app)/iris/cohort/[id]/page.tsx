/** One person's Iris sittings, question by question, with the answers they chose. Iris administrators only. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { personDetail } from "@/lib/iris/cohort";
import { canManageIris } from "@/lib/roles";
import { PersonView } from "./person-view";

export default async function IrisPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  const detail = await personDetail(decodeURIComponent((await params).id), "A");
  if (!detail) notFound();
  return (
    <PersonView
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

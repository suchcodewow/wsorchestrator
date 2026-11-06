/**
 * The Diagnostic's Participants and their placements, a page at a time, as a
 * table or as a radar per person; Bootcamp Auto-Enroll, and adding someone
 * by hand. Assessments Administrators only.
 */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { WideView } from "@/components/wide-view";
import { cohortSummary } from "@/lib/iris/cohort";
import { getAutoEnroll, listParticipants, participantCounts } from "@/lib/iris/participants";
import { IRIS_PARTICIPANT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";
import { ParticipantsView } from "./participants-view";

export default async function DiagnosticParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  const params = await searchParams;
  const query = parseListQuery(params, IRIS_PARTICIPANT_LIST);
  const view = params.view === "charts" ? "charts" : "table";
  const [page, counts, autoEnroll, summary] = await Promise.all([
    listParticipants(query, "A"),
    participantCounts(),
    getAutoEnroll(),
    view === "charts" ? cohortSummary("A", query.q) : null,
  ]);
  // A column per subject: the table needs the browser's width, not the reading column's.
  return (
    <WideView>
      <ParticipantsView
        query={query}
        view={view}
        summary={summary}
        counts={counts}
        autoEnroll={{ ...autoEnroll, changedAt: autoEnroll.changedAt?.toISOString() ?? null }}
        page={{
          ...page,
          rows: page.rows.map((r) => ({
            ...r,
            addedAt: r.addedAt?.toISOString() ?? null,
            finishedAt: r.finishedAt?.toISOString() ?? null,
          })),
        }}
      />
    </WideView>
  );
}

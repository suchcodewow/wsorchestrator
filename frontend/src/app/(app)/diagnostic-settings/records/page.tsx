/**
 * The Diagnostic's Records: everyone with a sitting and their placements,
 * Participant or not, a page at a time, as a table or as a radar per person.
 * Choosing someone opens their sittings below. Assessments Administrators only.
 */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { WideView } from "@/components/wide-view";
import { cohortSummary, personDetail } from "@/lib/iris/cohort";
import { listRecords, recordCount } from "@/lib/iris/participants";
import { IRIS_RECORD_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";
import { RecordsView } from "./records-view";

export default async function DiagnosticRecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  const params = await searchParams;
  const query = parseListQuery(params, IRIS_RECORD_LIST);
  const view = params.view === "charts" ? "charts" : "table";
  const person = typeof params.person === "string" ? params.person : null;
  const [page, total, summary, detail] = await Promise.all([
    listRecords(query, "A"),
    recordCount("A"),
    // The charts follow the search; the open person is drawn against every Participant.
    cohortSummary("A", view === "charts" ? query.q : ""),
    person ? personDetail(person, "A") : null,
  ]);
  const everyone = view === "charts" && query.q && detail ? await cohortSummary("A") : summary;
  // A column per subject: the table needs the browser's width, not the reading column's.
  return (
    <WideView>
      <RecordsView
        query={query}
        view={view}
        summary={summary}
        total={total}
        page={{
          ...page,
          rows: page.rows.map((r) => ({
            ...r,
            addedAt: r.addedAt?.toISOString() ?? null,
            finishedAt: r.finishedAt?.toISOString() ?? null,
          })),
        }}
        detail={
          detail && {
            ...detail,
            sittings: detail.sittings.map((s) => ({
              ...s,
              startedAt: s.startedAt.toISOString(),
              finishedAt: s.finishedAt?.toISOString() ?? null,
            })),
          }
        }
        detailSummary={everyone}
      />
    </WideView>
  );
}

/**
 * Everyone with a finished Iris test and their placements, a page at a time,
 * as a table or as a radar per person. Iris administrators only.
 */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { cohortSummary, listCohort } from "@/lib/iris/cohort";
import { IRIS_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";
import { CohortView } from "./cohort-view";

export default async function IrisCohortPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  const params = await searchParams;
  const query = parseListQuery(params, IRIS_COHORT_LIST);
  const view = params.view === "charts" ? "charts" : "table";
  const [page, summary] = await Promise.all([
    listCohort(query, "A"),
    view === "charts" ? cohortSummary("A", query.q) : null,
  ]);
  return (
    <CohortView
      query={query}
      view={view}
      summary={summary}
      page={{ ...page, rows: page.rows.map((r) => ({ ...r, finishedAt: r.finishedAt.toISOString() })) }}
    />
  );
}

/** Everyone with a finished Iris test and their placements, a page at a time. Iris administrators only. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { listCohort } from "@/lib/iris/cohort";
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

  const query = parseListQuery(await searchParams, IRIS_COHORT_LIST);
  const page = await listCohort(query, "A");
  return (
    <CohortView
      query={query}
      page={{ ...page, rows: page.rows.map((r) => ({ ...r, finishedAt: r.finishedAt.toISOString() })) }}
    />
  );
}

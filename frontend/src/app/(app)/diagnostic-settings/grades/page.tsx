/**
 * The Diagnostic's Grades: typed answers whose grade Claude was unsure of,
 * the oldest first, a page at a time; the decided ones too with `?decided=1`.
 * Assessments Administrators only.
 */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { WideView } from "@/components/wide-view";
import { listGrades } from "@/lib/iris/grades";
import { IRIS_GRADE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";
import { GradesTable } from "./grades-table";

export default async function DiagnosticGradesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  const params = await searchParams;
  const query = parseListQuery(params, IRIS_GRADE_LIST);
  const showDecided = params.decided === "1";
  // Question, expected answer and their answer side by side want the browser's width.
  return (
    <WideView>
      <GradesTable query={query} showDecided={showDecided} page={await listGrades(query, { decided: showDecided })} />
    </WideView>
  );
}

/** One active assessment's attendees, a page at a time, with their scores at the active bootcamp. */

import { notFound } from "next/navigation";
import { z } from "zod";
import { attendeeCounts, listAttendees, scoringAssessment, scoringBootcamp } from "@/lib/evals/scoring";
import { ASSESSMENT_ATTENDEE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { AttendeesView } from "./attendees-view";

export default async function AssessmentAttendeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ stage: string; assessmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stage, assessmentId } = await params;
  const id = z.string().uuid().safeParse(assessmentId);
  const assessment = id.success ? await scoringAssessment(id.data) : null;
  if (!assessment || assessment.stage !== stage) notFound();

  const bootcamp = await scoringBootcamp(assessment.stage);
  const query = parseListQuery(await searchParams, ASSESSMENT_ATTENDEE_LIST);
  const [page, counts] = await Promise.all([
    listAttendees(assessment, bootcamp?.id ?? null, query),
    attendeeCounts(assessment, bootcamp?.id ?? null),
  ]);
  return <AttendeesView assessment={assessment} bootcamp={bootcamp} query={query} page={page} counts={counts} />;
}

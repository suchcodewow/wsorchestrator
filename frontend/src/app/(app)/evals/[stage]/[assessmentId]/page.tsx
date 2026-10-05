/** One active assessment's attendees, a page at a time, with their scores at the active bootcamp. */

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth, signInPath } from "@/auth";
import { attendeeCounts, breakoutRooms, listAttendees, scoringAssessment, scoringBootcamp } from "@/lib/evals/scoring";
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
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const { stage, assessmentId } = await params;
  const id = z.string().uuid().safeParse(assessmentId);
  const assessment = id.success ? await scoringAssessment(id.data) : null;
  if (!assessment || assessment.stage !== stage) notFound();

  const bootcamp = await scoringBootcamp(assessment.stage);
  const search = await searchParams;
  const query = parseListQuery(search, ASSESSMENT_ATTENDEE_LIST);
  const email = session.user.email ?? null;
  const mine = search.mine === "1" && email !== null;
  const [page, counts, rooms] = await Promise.all([
    listAttendees(assessment, bootcamp?.id ?? null, query, mine ? email : null),
    attendeeCounts(assessment, bootcamp?.id ?? null, email),
    breakoutRooms(assessment, bootcamp?.id ?? null, email),
  ]);
  return (
    <AttendeesView
      assessment={assessment}
      bootcamp={bootcamp}
      query={query}
      mine={mine}
      page={page}
      counts={counts}
      rooms={rooms}
    />
  );
}

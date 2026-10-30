/**
 * Claude's read of one filed transcript against the assessment's criteria: a
 * short note per criterion, which the scoring form appends to its comments.
 * Nothing is saved; the judge saves the form as usual.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { askedCriteria, scoringTarget } from "@/lib/evals/scoring";
import { REVIEW_STATUS_FOR, reviewTranscript } from "@/lib/evals/transcript-review";
import { getTranscript } from "@/lib/evals/transcripts";
import { formatDuration } from "@/lib/recording/format";
import { canScoreAssessments } from "@/lib/roles";

export const maxDuration = 120;

type Params = { params: Promise<{ assessmentId: string; employeeId: string; transcriptId: string }> };

const uuidSchema = z.string().uuid();
const employeeIdSchema = z.string().min(1).max(200);

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canScoreAssessments);
  if (error) return error;

  const { assessmentId, employeeId, transcriptId } = await params;
  const id = uuidSchema.safeParse(assessmentId);
  const employee = employeeIdSchema.safeParse(employeeId);
  const transcriptKey = uuidSchema.safeParse(transcriptId);
  if (!id.success || !employee.success || !transcriptKey.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const target = await scoringTarget(id.data, employee.data);
  if (!target.ok) {
    return NextResponse.json({ error: target.error }, { status: target.error === "not_found" ? 404 : 409 });
  }
  const filing = { bootcampId: target.bootcamp.id, assessmentId: target.assessment.id, attendeeEmail: target.attendee.email };
  const [transcript, criteria] = await Promise.all([
    getTranscript(filing, transcriptKey.data),
    askedCriteria(target.assessment.id),
  ]);
  if (!transcript) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!transcript.text.trim()) return NextResponse.json({ error: "empty" }, { status: 409 });
  if (criteria.length === 0) return NextResponse.json({ error: "no_criteria" }, { status: 409 });

  noteAudit({
    target: transcript.id,
    targetLabel: `${target.attendee.email}, ${target.assessment.name}: Claude's review of a transcript of ${formatDuration(transcript.durationMs)}`,
  });
  const result = await reviewTranscript({
    assessmentName: target.assessment.name,
    attendeeName: target.attendee.fullName,
    criteria,
    transcript: transcript.text,
  });
  if (!result.ok) {
    if (result.detail) noteAudit({ detail: { upstream: result.detail } });
    return NextResponse.json({ error: result.error }, { status: REVIEW_STATUS_FOR[result.error] });
  }
  noteAudit({ detail: { criteria: criteria.length, comments: result.comments.length } });
  return NextResponse.json({ comments: result.comments });
});

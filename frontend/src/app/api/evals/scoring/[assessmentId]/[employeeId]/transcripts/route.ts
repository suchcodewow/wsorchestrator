/**
 * Filing the transcript of one recording made while scoring an attendee. The
 * audio is sent as form data, transcribed once, and dropped; the transcript is
 * kept with the attendee's assessment at the active bootcamp.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { scoringTarget } from "@/lib/evals/scoring";
import { saveTranscript, TRANSCRIPT_STATUS_FOR } from "@/lib/evals/transcripts";
import { MAX_TRANSCRIBE_BYTES } from "@/lib/recording/deepgram";
import { formatDuration } from "@/lib/recording/format";
import { canScoreAssessments } from "@/lib/roles";

export const maxDuration = 120;

type Params = { params: Promise<{ assessmentId: string; employeeId: string }> };

const assessmentIdSchema = z.string().uuid();
const employeeIdSchema = z.string().min(1).max(200);

/** A day's recording at most; anything longer is a clock gone wrong. */
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

const fieldsSchema = z.object({
  recordingId: z.string().uuid(),
  recordedAt: z.coerce.number().int().positive().transform((ms) => new Date(ms)),
  durationMs: z.coerce.number().int().min(0).max(MAX_DURATION_MS),
});

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canScoreAssessments);
  if (error) return error;

  const { assessmentId, employeeId } = await params;
  const id = assessmentIdSchema.safeParse(assessmentId);
  const employee = employeeIdSchema.safeParse(employeeId);
  if (!id.success || !employee.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  const fields = fieldsSchema.safeParse({
    recordingId: form?.get("recordingId"),
    recordedAt: form?.get("recordedAt"),
    durationMs: form?.get("durationMs"),
  });
  if (!audio || typeof audio === "string" || !fields.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (audio.size === 0) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (audio.size > MAX_TRANSCRIBE_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const target = await scoringTarget(id.data, employee.data);
  if (!target.ok) {
    return NextResponse.json({ error: target.error }, { status: target.error === "not_found" ? 404 : 409 });
  }

  const result = await saveTranscript(
    user.id,
    { bootcampId: target.bootcamp.id, assessmentId: target.assessment.id, attendeeEmail: target.attendee.email },
    { ...fields.data, audio },
  );
  if (!result.ok) {
    if (result.detail) noteAudit({ detail: { upstream: result.detail } });
    return NextResponse.json({ error: result.error }, { status: TRANSCRIPT_STATUS_FOR[result.error] });
  }

  const { transcript, created } = result;
  noteAudit({
    target: transcript.id,
    targetLabel: `${target.attendee.email}, ${target.assessment.name}: transcript of ${formatDuration(transcript.durationMs)}`,
    detail: { bytes: audio.size, created },
  });
  return NextResponse.json(transcript, { status: created ? 201 : 200 });
});

/** Changes or deletes one Google meeting. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  googleMeeting,
  meetingPatchSchema,
  removeGoogleMeetingRow,
  STATUS_FOR,
  updateGoogleMeeting,
} from "@/lib/evals/google-meetings";
import { cancelGoogleMeeting } from "@/lib/evals/google-meetings-sync";

const idSchema = z.string().uuid();

export const PATCH = audited(async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = meetingPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await updateGoogleMeeting(id.data, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  }
  noteAudit({ targetLabel: result.meeting.title });
  return NextResponse.json(result.meeting);
});

// Cancelling an invite can wait on Google and Zoom.
export const maxDuration = 60;

export const DELETE = audited(async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const meeting = await googleMeeting(id.data);
  if (!meeting) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  noteAudit({ targetLabel: meeting.title });

  const cancelled = await cancelGoogleMeeting(meeting);
  if (!cancelled.ok) {
    return NextResponse.json({ error: cancelled.error, detail: cancelled.message }, { status: STATUS_FOR[cancelled.error] });
  }
  await removeGoogleMeetingRow(meeting.id);
  return NextResponse.json({ ok: true });
});

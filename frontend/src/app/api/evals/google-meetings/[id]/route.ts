/**
 * Changes or deletes one picked meeting. Renaming or deleting one first takes
 * everyone the sync invited off its upcoming occurrences, without emailing them;
 * neither is allowed while a sync is running.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  meetingSelection,
  meetingSelectionPatchSchema,
  meetingSyncInProgress,
  removeMeetingSelectionRow,
  STATUS_FOR,
  updateMeetingSelection,
} from "@/lib/evals/google-meetings";
import { meetingKey } from "@/lib/evals/meeting-plan";
import { takeMeetingGuestsOff } from "@/lib/evals/meeting-sync";

const idSchema = z.string().uuid();

// Taking invites back is a call to Google for each upcoming occurrence.
export const maxDuration = 60;

export const PATCH = audited(async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  const meeting = id.success ? await meetingSelection(id.data) : null;
  if (!meeting) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = meetingSelectionPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  noteAudit({ target: meeting.id, targetLabel: parsed.data.name ?? meeting.name, detail: { ...parsed.data, was: meeting.name } });

  if (parsed.data.name !== undefined && meetingKey(parsed.data.name) !== meetingKey(meeting.name)) {
    if (await meetingSyncInProgress()) {
      return NextResponse.json({ error: "running" }, { status: STATUS_FOR.running });
    }
    const taken = await takeMeetingGuestsOff(meeting.id);
    if (!taken.ok) {
      return NextResponse.json({ error: taken.error, detail: taken.message }, { status: STATUS_FOR[taken.error] });
    }
  }

  const result = await updateMeetingSelection(meeting.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  }
  return NextResponse.json(result.meeting);
});

export const DELETE = audited(async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  const meeting = id.success ? await meetingSelection(id.data) : null;
  if (!meeting) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  noteAudit({ target: meeting.id, targetLabel: meeting.name });

  if (await meetingSyncInProgress()) {
    return NextResponse.json({ error: "running" }, { status: STATUS_FOR.running });
  }
  const taken = await takeMeetingGuestsOff(meeting.id);
  if (!taken.ok) {
    return NextResponse.json({ error: taken.error, detail: taken.message }, { status: STATUS_FOR[taken.error] });
  }
  await removeMeetingSelectionRow(meeting.id);
  return NextResponse.json({ ok: true, events: taken.events });
});

/** An administrator's word on whether one person attended one picked meeting, over Zoom's; `attended: null` clears it. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { attendanceMarkSchema, setAttendanceMark } from "@/lib/evals/google-meetings";

const idSchema = z.string().uuid();

export const PUT = audited(async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const parsed = attendanceMarkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await setAttendanceMark(user.id, id.data, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  noteAudit({
    target: result.meeting.id,
    targetLabel: `${result.meeting.name}: ${parsed.data.email}`,
    detail: { attended: parsed.data.attended },
  });
  return NextResponse.json({ ok: true, email: parsed.data.email, attended: parsed.data.attended });
});

/** Moves one of an attendee's participation counters up or down by one. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { PARTICIPATION_STATUS_FOR, adjustMark, adjustSchema } from "@/lib/evals/participation";
import { canManageBootcampRecords, canScoreAssessments } from "@/lib/roles";

type Params = { params: Promise<{ employeeId: string }> };

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canScoreAssessments);
  if (error) return error;

  const parsed = adjustSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { employeeId } = await params;
  const result = await adjustMark(user.id, employeeId.slice(0, 200), parsed.data, canManageBootcampRecords(user.access));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: PARTICIPATION_STATUS_FOR[result.error] });

  noteAudit({
    target: result.sheet.attendee.email,
    targetLabel: `${result.sheet.attendee.fullName}: ${result.descriptor}`,
    detail: { delta: parsed.data.delta, moved: result.moved },
  });
  return NextResponse.json(result.sheet);
});

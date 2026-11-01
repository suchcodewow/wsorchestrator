/** Writes one attendee's participation comments and score again from the marks they have now. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { REGENERATE_STATUS_FOR, regenerateParticipation } from "@/lib/evals/participation";
import { canManageBootcampRecords } from "@/lib/roles";

export const maxDuration = 120;

type Params = { params: Promise<{ employeeId: string }> };

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;

  const { employeeId } = await params;
  const result = await regenerateParticipation(user.id, employeeId.slice(0, 200));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: REGENERATE_STATUS_FOR[result.error] });

  noteAudit({
    target: result.email,
    targetLabel: `Participation for ${result.sheet.attendee.fullName}`,
    detail: { score: result.sheet.saved?.averageScore ?? null },
  });
  return NextResponse.json(result.sheet);
});

/** One attendee's participation marks at the active bootcamp, as the popup shows them. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { PARTICIPATION_STATUS_FOR, getParticipationSheet } from "@/lib/evals/participation";
import { canManageBootcampRecords, canSeeEvals } from "@/lib/roles";

type Params = { params: Promise<{ employeeId: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canSeeEvals);
  if (error) return error;

  const { employeeId } = await params;
  const result = await getParticipationSheet(employeeId.slice(0, 200), canManageBootcampRecords(user.access));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: PARTICIPATION_STATUS_FOR[result.error] });
  return NextResponse.json(result.sheet);
}

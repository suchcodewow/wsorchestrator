/** The comments left on one session of a daily survey, with who left each and the rating they gave. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { canUseTraining } from "@/lib/roles";
import { listSessionComments } from "@/lib/surveys/surveys";

type Params = { params: Promise<{ id: string; sessionId: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const { id, sessionId } = await params;
  const result = await listSessionComments(id, sessionId);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(result);
}

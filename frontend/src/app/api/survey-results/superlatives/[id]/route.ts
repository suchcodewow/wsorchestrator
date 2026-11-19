/** One Bootcamp superlatives survey's results: the votes on each superlative. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { canUseTraining } from "@/lib/roles";
import { getSuperlativeResult } from "@/lib/surveys/superlatives";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const survey = await getSuperlativeResult((await params).id);
  if (!survey) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ survey });
}
